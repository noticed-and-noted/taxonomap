"""
Upload baked cubes to a Hugging Face dataset repo, then point latest.json at them.

The new snapshot's folder goes up first; latest.json changes last, so the app
never reads a half-uploaded snapshot. Older snapshots are then deleted.

    HF_TOKEN=hf_... python upload_cubes.py --out cubes --repo your-org/taxonomap-cubes
"""

from __future__ import annotations

import argparse
import json
import pathlib

from huggingface_hub import HfApi

# Keep the previous snapshot for a cycle, so a browser mid-session can finish reading it.
SNAPSHOTS_KEPT = 2


def parse_arguments() -> argparse.Namespace:
    """Command-line options."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=pathlib.Path, required=True, help="the folder bake_cubes.py wrote")
    parser.add_argument("--repo", required=True, help="dataset repo id, such as your-org/taxonomap-cubes")
    return parser.parse_args()


def delete_old_snapshots(api: HfApi, repo: str) -> None:
    """Remove all but the newest snapshots from the repo, so storage stays flat month to month."""
    names = {
        path.split("/")[1]
        for path in api.list_repo_files(repo, repo_type="dataset")
        if path.startswith("snapshots/")
    }
    for snapshot in sorted(names)[:-SNAPSHOTS_KEPT]:
        api.delete_folder(f"snapshots/{snapshot}", repo_id=repo, repo_type="dataset", commit_message=f"Drop {snapshot}")


def main() -> None:
    """Upload the newest bake and switch latest.json to it."""
    arguments = parse_arguments()
    latest = json.loads((arguments.out / "latest.json").read_text())
    snapshot = latest["snapshot"]
    api = HfApi()
    api.create_repo(arguments.repo, repo_type="dataset", exist_ok=True)

    api.upload_large_folder(
        repo_id=arguments.repo,
        repo_type="dataset",
        folder_path=arguments.out,
        allow_patterns=[f"snapshots/{snapshot}/**"],
    )
    api.upload_file(
        path_or_fileobj=arguments.out / "latest.json",
        path_in_repo="latest.json",
        repo_id=arguments.repo,
        repo_type="dataset",
        commit_message=f"Point latest at {snapshot}",
    )
    delete_old_snapshots(api, arguments.repo)
    print(f"Uploaded {snapshot} to https://huggingface.co/datasets/{arguments.repo}")


if __name__ == "__main__":
    main()
