"""
Bake Taxonomap's data cubes from GBIF's monthly occurrence snapshot on AWS Open Data.

Reads the snapshot straight from S3 once, keeping only a slim table of the
columns the cubes need, reduces billions of records to pre-counted cubes, and
writes them as sorted Parquet files a browser can query with a few HTTP range
requests: the map and chart cubes by taxon, and the cell cube and records index
by place, for the panel a click on a hex opens.

    python bake_cubes.py --out cubes                # whole newest snapshot
    python bake_cubes.py --out cubes --parts 5      # quick sample of 5 parts
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ElementTree

import duckdb

S3_NAMESPACE = "{http://s3.amazonaws.com/doc/2006-03-01/}"

# Each rank becomes its own partition, so a query only opens files for the rank it filters on.
# "life" is every record, for the unfiltered map.
RANKS = ["life", "kingdom", "phylum", "class", "order", "family", "genus", "species"]

# H3 resolutions the map cube is cut at: the browser picks one by zoom level.
# Resolution 2 cells are ~87,000 km², 5 are ~250 km².
MAP_RESOLUTIONS = [2, 3, 4, 5]
BASE_RESOLUTION = max(MAP_RESOLUTIONS)

# The issues GBIF's hasGeospatialIssue covers, which its maps leave out.
GEOSPATIAL_ISSUES = ["ZERO_COORDINATE", "COORDINATE_OUT_OF_RANGE", "COORDINATE_INVALID", "COUNTRY_COORDINATE_MISMATCH"]

# Small row groups let a range-request reader skip straight to one taxon's rows.
ROW_GROUP_ROWS = 50_000

# Rows per file (tens of MB): small enough that a reader's footer fetch is cheap, large enough to keep
# the file count down. A taxon never splits across files, so one very common taxon can make a file bigger.
ROWS_PER_FILE = 4_000_000

# The cell cube and records index are read one cell at a time, so their row groups are smaller: a click
# downloads little beyond the cell's own rows. Records files hold fewer rows so their footers stay small.
CELL_ROW_GROUP_ROWS = 20_000
RECORD_ROW_GROUP_ROWS = 10_000
RECORD_ROWS_PER_FILE = 1_000_000

TAXON_PATH = 'kingdom, phylum, class, "order", family, genus, species'

# A Parquet file ends with its footer's length (4 bytes) and the magic "PAR1".
PARQUET_TAIL_BYTES = 8


def bucket_url(region: str) -> str:
    """The public HTTPS address of GBIF's snapshot bucket in one AWS region."""
    return f"https://gbif-open-data-{region}.s3.{region}.amazonaws.com"


def list_bucket(region: str, prefix: str, element: str, delimiter: str | None = None) -> list[str]:
    """
    Every value of one element across all pages of an anonymous S3 listing.

    @param element: path inside the listing, such as "Contents/Key" or "CommonPrefixes/Prefix".
    """
    values: list[str] = []
    page_token: str | None = None
    while True:
        query = {"list-type": "2", "prefix": prefix}
        if delimiter:
            query["delimiter"] = delimiter
        if page_token:
            query["continuation-token"] = page_token
        with urllib.request.urlopen(f"{bucket_url(region)}/?{urllib.parse.urlencode(query)}") as response:
            page = ElementTree.parse(response).getroot()
        path = "/".join(f"{S3_NAMESPACE}{part}" for part in element.split("/"))
        values += [node.text for node in page.findall(path) if node.text]
        page_token = page.findtext(f"{S3_NAMESPACE}NextContinuationToken")
        if not page_token:
            return values


def snapshot_parts(region: str, snapshot: str | None) -> tuple[str, list[str]]:
    """The chosen (or newest) snapshot's date and the HTTPS address of each of its Parquet parts."""
    if not snapshot:
        prefixes = list_bucket(region, "occurrence/", "CommonPrefixes/Prefix", delimiter="/")
        snapshot = sorted(prefixes)[-1].removeprefix("occurrence/").strip("/")
    keys = list_bucket(region, f"occurrence/{snapshot}/occurrence.parquet/", "Contents/Key")
    return snapshot, [f"{bucket_url(region)}/{key}" for key in sorted(keys) if not key.endswith("/")]


def sample_evenly(parts: list[str], wanted: int | None) -> list[str]:
    """Parts spread through the snapshot, so a sample isn't all from one publisher's stretch."""
    if not wanted or wanted >= len(parts):
        return parts
    return [parts[index * len(parts) // wanted] for index in range(wanted)]


def connect(work_dir: pathlib.Path, memory_limit: str | None) -> duckdb.DuckDBPyConnection:
    """A DuckDB connection with HTTP and H3 support that spills big aggregations to the work folder."""
    connection = duckdb.connect()
    for statement in ["INSTALL httpfs", "LOAD httpfs", "INSTALL h3 FROM community", "LOAD h3"]:
        connection.execute(statement)
    connection.execute(f"SET temp_directory = '{work_dir / 'spill'}'")
    connection.execute("SET http_retries = 10")
    if memory_limit:
        connection.execute(f"SET memory_limit = '{memory_limit}'")
    return connection


def extract_records(connection: duckdb.DuckDBPyConnection, parts: list[str], records_file: pathlib.Path) -> None:
    """
    The one pass over the raw snapshot: each present record's key, taxon path, species key, date, basis
    of record and H3 cell, so every cube after this reads a local file instead of S3.
    Records without usable coordinates keep a null cell: the charts count them, the map leaves them out.
    """
    issues = ", ".join(f"'{issue}'" for issue in GEOSPATIAL_ISSUES)
    connection.execute(
        f"""
        COPY (
          SELECT TRY_CAST(gbifid AS BIGINT) AS gbifid, {TAXON_PATH},
                 TRY_CAST(specieskey AS INTEGER) AS specieskey,
                 year::SMALLINT AS year, month::TINYINT AS month, basisofrecord,
                 CASE WHEN decimallatitude IS NOT NULL AND decimallongitude IS NOT NULL
                       AND NOT list_has_any(issue, [{issues}])
                      THEN h3_latlng_to_cell(decimallatitude, decimallongitude, {BASE_RESOLUTION}) END AS cell
          FROM read_parquet($parts)
          WHERE occurrencestatus = 'PRESENT'
        ) TO '{records_file}' (FORMAT parquet, COMPRESSION zstd)
        """,
        {"parts": parts},
    )


def bake_base(connection: duckdb.DuckDBPyConnection, records_file: pathlib.Path, base_file: pathlib.Path) -> None:
    """
    Count records by full taxon path in two grouping sets: by species key, year, month and H3 cell for
    the map and cell cubes, and by year, month and basis of record for charts.
    """
    sets = f"({TAXON_PATH}, specieskey, year, month, cell), ({TAXON_PATH}, year, month, basisofrecord)"
    connection.execute(
        f"""
        COPY (
          SELECT {TAXON_PATH}, specieskey, year, month, basisofrecord, cell,
                 GROUPING(basisofrecord) = 1 AS is_map,
                 count(*)::BIGINT AS records
          FROM read_parquet('{records_file}')
          GROUP BY GROUPING SETS ({sets})
        ) TO '{base_file}' (FORMAT parquet, COMPRESSION zstd)
        """
    )


def taxon_columns(rank: str) -> tuple[str, str, str]:
    """SQL for a rank's kingdom and taxon columns, and the clause that keeps rows named at that rank."""
    if rank == "life":
        return "NULL::VARCHAR", "'Life'", "TRUE"
    column = f'"{rank}"'
    return "kingdom", column, f"{column} IS NOT NULL"


def write_sorted(
    connection: duckdb.DuckDBPyConnection,
    select_sql: str,
    sort: str,
    out_dir: pathlib.Path,
    key: str = "taxon",
    rows_per_file: int = ROWS_PER_FILE,
    row_group_rows: int = ROW_GROUP_ROWS,
) -> None:
    """
    Write a query to a folder of files sorted by `key` (a taxon name or an H3 cell), so each key sits in
    a few row groups. Keys are dealt into numbered buckets of contiguous values, one file each, so the
    manifest can name the one file that holds a key (DuckDB's own file splitting writes overlapping
    ranges in parallel).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    connection.execute(
        f"""
        COPY (
          WITH counted AS ({select_sql}),
          sizes AS (SELECT {key} AS bucket_key, count(*) AS key_rows FROM counted GROUP BY {key}),
          buckets AS (
            SELECT bucket_key,
                   (sum(key_rows) OVER (ORDER BY bucket_key) - key_rows) // {rows_per_file} AS bucket
            FROM sizes)
          SELECT counted.*, bucket FROM counted JOIN buckets ON counted.{key} = buckets.bucket_key ORDER BY {sort}
        ) TO '{out_dir}'
        (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {row_group_rows}, PARTITION_BY (bucket), OVERWRITE_OR_IGNORE)
        """
    )


def bake_map(connection: duckdb.DuckDBPyConnection, base_file: pathlib.Path, out_dir: pathlib.Path) -> None:
    """
    The map cube: records by taxon, year and H3 cell, one folder per resolution and rank.
    Sorting by cell inside a taxon keeps nearby cells together, so a zoomed-in view can skip row groups.
    """
    for resolution in MAP_RESOLUTIONS:
        for rank in RANKS:
            kingdom, taxon, named = taxon_columns(rank)
            select_sql = f"""
                SELECT {kingdom} AS kingdom, {taxon} AS taxon, year,
                       h3_cell_to_parent(cell, {resolution}) AS cell, sum(records)::BIGINT AS records
                FROM read_parquet('{base_file}')
                WHERE is_map AND cell IS NOT NULL AND {named}
                GROUP BY ALL"""
            write_sorted(connection, select_sql, "taxon, kingdom, cell, year", out_dir / f"res={resolution}/rank={rank}")


def bake_charts(connection: duckdb.DuckDBPyConnection, base_file: pathlib.Path, out_dir: pathlib.Path) -> None:
    """The charts cube: records by taxon, year, month and basis of record, one folder per rank."""
    for rank in RANKS:
        kingdom, taxon, named = taxon_columns(rank)
        select_sql = f"""
            SELECT {kingdom} AS kingdom, {taxon} AS taxon, year, month, basisofrecord,
                   sum(records)::BIGINT AS records
            FROM read_parquet('{base_file}')
            WHERE NOT is_map AND {named}
            GROUP BY ALL"""
        write_sorted(connection, select_sql, "taxon, kingdom, year, month", out_dir / f"rank={rank}")


def bake_cells(connection: duckdb.DuckDBPyConnection, base_file: pathlib.Path, out_dir: pathlib.Path) -> None:
    """
    The cell cube: records by H3 cell, full taxon path, species, year and month, one folder per
    resolution. Sorted by cell, so the panel for a clicked hex is one small read: its count, months,
    classes and species, under any taxon and year filter, all come from the cell's own rows.
    """
    for resolution in MAP_RESOLUTIONS:
        select_sql = f"""
            SELECT h3_cell_to_parent(cell, {resolution}) AS cell, {TAXON_PATH}, specieskey, year, month,
                   sum(records)::BIGINT AS records
            FROM read_parquet('{base_file}')
            WHERE is_map AND cell IS NOT NULL
            GROUP BY ALL"""
        write_sorted(
            connection,
            select_sql,
            "cell, species, year, month",
            out_dir / f"res={resolution}",
            key="cell",
            row_group_rows=CELL_ROW_GROUP_ROWS,
        )


def bake_records(connection: duckdb.DuckDBPyConnection, records_file: pathlib.Path, out_dir: pathlib.Path) -> None:
    """
    The records index: one slim row per mapped record, sorted by its finest cell, newest first within
    it. A coarser cell's descendants are one contiguous run of cell numbers, so this one index pages the
    records of a hex at any zoom. The full record comes from GBIF by key.
    """
    select_sql = f"""
        SELECT cell, gbifid, {TAXON_PATH}, specieskey, year
        FROM read_parquet('{records_file}')
        WHERE cell IS NOT NULL AND gbifid IS NOT NULL"""
    write_sorted(
        connection,
        select_sql,
        "cell, year DESC NULLS LAST, gbifid",
        out_dir,
        key="cell",
        rows_per_file=RECORD_ROWS_PER_FILE,
        row_group_rows=RECORD_ROW_GROUP_ROWS,
    )


def footer_bytes(path: pathlib.Path) -> int:
    """A Parquet file's footer length plus the 8 bytes after it (the length itself and the "PAR1" magic)."""
    with path.open("rb") as file:
        file.seek(-PARQUET_TAIL_BYTES, 2)
        return int.from_bytes(file.read(4), "little") + PARQUET_TAIL_BYTES


def file_ranges(connection: duckdb.DuckDBPyConnection, folder: pathlib.Path, root: pathlib.Path) -> list[dict]:
    """
    Each file's first and last key: a taxon name, or an H3 cell number (as a string, which JSON keeps
    exact). A browser can't list a folder over HTTP, so this tells it which file holds a key.
    The writer may not keep files in order, so a reader opens every file whose range covers the key.
    """
    by_cell = folder.relative_to(root).parts[0] in ("cells", "records")
    key = "cell" if by_cell else "taxon"
    # The records index has a row per record, so it has no count column to sum.
    records = "count(*)" if folder.name == "records" else "sum(records)"
    rows = connection.execute(
        f"""
        SELECT filename, min({key}), max({key}), {records}::BIGINT, count(*)::BIGINT
        FROM read_parquet('{folder}/bucket=*/*.parquet', filename = true)
        GROUP BY filename ORDER BY 2
        """
    ).fetchall()
    # The byte size saves a reader the extra request it would otherwise make to learn where the footer is,
    # and the footer's own length lets it fetch the whole footer in one request.
    return [
        {
            "path": pathlib.Path(name).relative_to(root).as_posix(),
            "bytes": pathlib.Path(name).stat().st_size,
            "footer": footer_bytes(pathlib.Path(name)),
            "first": str(first),
            "last": str(last),
            "records": records,
            "rows": count,
        }
        for name, first, last, records, count in rows
    ]


def write_manifest(
    connection: duckdb.DuckDBPyConnection, out_dir: pathlib.Path, snapshot: str, parts: int, parts_total: int
) -> None:
    """The index of every cube file, which the browser fetches first."""
    folders = sorted({file.parent.parent for file in out_dir.rglob("bucket=*/*.parquet")})
    manifest = {
        "snapshot": snapshot,
        "partsRead": parts,
        # A sample read fewer parts than the snapshot has; the app scales its counts by the ratio.
        "partsTotal": parts_total,
        "bakedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rowGroupRows": ROW_GROUP_ROWS,
        "folders": {folder.relative_to(out_dir).as_posix(): file_ranges(connection, folder, out_dir) for folder in folders},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))


def timed(label: str, task) -> None:
    """Run one stage and print how long it took."""
    started = time.monotonic()
    task()
    print(f"{label}: {time.monotonic() - started:,.0f} s", flush=True)


def parse_arguments() -> argparse.Namespace:
    """Command-line options."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=pathlib.Path, required=True, help="folder for the finished cubes")
    parser.add_argument("--work", type=pathlib.Path, default=pathlib.Path("work"), help="scratch folder (fast disk)")
    parser.add_argument("--region", default="us-east-1", help="bucket region; run the bake in the same one")
    parser.add_argument("--snapshot", help="snapshot date such as 2026-11-01 (default: newest)")
    parser.add_argument("--parts", type=int, help="read only this many parts, for a quick test")
    parser.add_argument("--memory-limit", help="DuckDB memory limit, such as 200GB")
    return parser.parse_args()


def main() -> None:
    """Bake every cube for one snapshot into <out>/snapshots/<date>/."""
    arguments = parse_arguments()
    snapshot, parts = snapshot_parts(arguments.region, arguments.snapshot)
    chosen = sample_evenly(parts, arguments.parts)
    print(f"Snapshot {snapshot}: reading {len(chosen)} of {len(parts)} parts", flush=True)

    arguments.work.mkdir(parents=True, exist_ok=True)
    out_dir = arguments.out / "snapshots" / snapshot
    shutil.rmtree(out_dir, ignore_errors=True)
    records_file = arguments.work / "records.parquet"
    base_file = arguments.work / "base.parquet"
    connection = connect(arguments.work, arguments.memory_limit)

    timed("Scan the snapshot", lambda: extract_records(connection, chosen, records_file))
    timed("Count", lambda: bake_base(connection, records_file, base_file))
    timed("Map cube", lambda: bake_map(connection, base_file, out_dir / "map"))
    timed("Charts cube", lambda: bake_charts(connection, base_file, out_dir / "charts"))
    timed("Cell cube", lambda: bake_cells(connection, base_file, out_dir / "cells"))
    timed("Records index", lambda: bake_records(connection, records_file, out_dir / "records"))
    timed("Manifest", lambda: write_manifest(connection, out_dir, snapshot, len(chosen), len(parts)))
    (arguments.out / "latest.json").write_text(json.dumps({"snapshot": snapshot, "manifest": f"snapshots/{snapshot}/manifest.json"}))


if __name__ == "__main__":
    main()
