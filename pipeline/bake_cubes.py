"""
Bake Taxonomap's data cubes from GBIF's monthly occurrence snapshot on AWS Open Data.

Reads the snapshot straight from S3 (nothing raw is stored locally), reduces
billions of records to pre-counted cubes in one scan, and writes them as
sorted Parquet files a browser can query with a few HTTP range requests.

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


def bake_base(connection: duckdb.DuckDBPyConnection, parts: list[str], base_file: pathlib.Path) -> None:
    """
    The one pass over the raw snapshot: count records by full taxon path in two grouping sets,
    by year and H3 cell for the map, and by year, month and basis of record for charts.
    Charts keep records without coordinates; the map drops them in the rollup.
    """
    issues = ", ".join(f"'{issue}'" for issue in GEOSPATIAL_ISSUES)
    path = 'kingdom, phylum, class, "order", family, genus, species'
    connection.execute(
        f"""
        COPY (
          SELECT {path}, year::SMALLINT AS year, month::TINYINT AS month, basisofrecord,
                 CASE WHEN decimallatitude IS NOT NULL AND decimallongitude IS NOT NULL
                       AND NOT list_has_any(issue, [{issues}])
                      THEN h3_latlng_to_cell(decimallatitude, decimallongitude, {BASE_RESOLUTION}) END AS cell,
                 GROUPING(month) = 1 AS is_map,
                 count(*)::BIGINT AS records
          FROM read_parquet($parts)
          WHERE occurrencestatus = 'PRESENT'
          GROUP BY GROUPING SETS (({path}, year, cell), ({path}, year, month, basisofrecord))
        ) TO '{base_file}' (FORMAT parquet, COMPRESSION zstd)
        """,
        {"parts": parts},
    )


def taxon_columns(rank: str) -> tuple[str, str, str]:
    """SQL for a rank's kingdom and taxon columns, and the clause that keeps rows named at that rank."""
    if rank == "life":
        return "NULL::VARCHAR", "'Life'", "TRUE"
    column = f'"{rank}"'
    return "kingdom", column, f"{column} IS NOT NULL"


def write_sorted(connection: duckdb.DuckDBPyConnection, select_sql: str, sort: str, out_dir: pathlib.Path) -> None:
    """
    Write a query to a folder of files sorted by taxon, so each taxon sits in a few row groups.
    Taxa are dealt into numbered buckets of contiguous names, one file each, so the manifest can name
    the one file that holds a taxon (DuckDB's own file splitting writes overlapping ranges in parallel).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    connection.execute(
        f"""
        COPY (
          WITH counted AS ({select_sql}),
          sizes AS (SELECT taxon, count(*) AS taxon_rows FROM counted GROUP BY taxon),
          buckets AS (
            SELECT taxon,
                   (sum(taxon_rows) OVER (ORDER BY taxon) - taxon_rows) // {ROWS_PER_FILE} AS bucket
            FROM sizes)
          SELECT counted.*, bucket FROM counted JOIN buckets USING (taxon) ORDER BY {sort}
        ) TO '{out_dir}'
        (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP_ROWS}, PARTITION_BY (bucket), OVERWRITE_OR_IGNORE)
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


def file_ranges(connection: duckdb.DuckDBPyConnection, folder: pathlib.Path, root: pathlib.Path) -> list[dict]:
    """
    Each file's first and last taxon name.
    A browser can't list a folder over HTTP, so this tells it which file holds a taxon.
    The writer may not keep files in order, so a reader opens every file whose range covers the name.
    """
    rows = connection.execute(
        f"""
        SELECT filename, min(taxon), max(taxon), sum(records)::BIGINT, count(*)::BIGINT
        FROM read_parquet('{folder}/bucket=*/*.parquet', filename = true)
        GROUP BY filename ORDER BY 2
        """
    ).fetchall()
    # The byte size saves a reader the extra request it would otherwise make to learn where the footer is.
    return [
        {
            "path": pathlib.Path(name).relative_to(root).as_posix(),
            "bytes": pathlib.Path(name).stat().st_size,
            "first": first,
            "last": last,
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
    base_file = arguments.work / "base.parquet"
    connection = connect(arguments.work, arguments.memory_limit)

    timed("Scan and count the snapshot", lambda: bake_base(connection, chosen, base_file))
    timed("Map cube", lambda: bake_map(connection, base_file, out_dir / "map"))
    timed("Charts cube", lambda: bake_charts(connection, base_file, out_dir / "charts"))
    timed("Manifest", lambda: write_manifest(connection, out_dir, snapshot, len(chosen), len(parts)))
    (arguments.out / "latest.json").write_text(json.dumps({"snapshot": snapshot, "manifest": f"snapshots/{snapshot}/manifest.json"}))


if __name__ == "__main__":
    main()
