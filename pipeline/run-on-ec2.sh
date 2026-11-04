#!/usr/bin/env bash
# Bake and upload the cubes on a fresh Ubuntu 24.04 EC2 instance in us-east-1, then power off.
# Launch the instance with "Shutdown behavior: Terminate", so powering off also stops the bill.
#
#   HF_TOKEN=hf_... HF_REPO=your-org/taxonomap-cubes ./pipeline/run-on-ec2.sh
#   PARTS=200 POWER_OFF=0 HF_TOKEN=... HF_REPO=... ./pipeline/run-on-ec2.sh   # pilot on a sample
set -euo pipefail

: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access}"
: "${HF_REPO:?Set HF_REPO, such as your-org/taxonomap-cubes}"
export HF_TOKEN

PIPELINE_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRATCH=/mnt/scratch

# Only ever format the instance's local NVMe (its model names it), never an EBS volume such as the root disk.
DISK="$(lsblk -dpno NAME,MODEL | awk '/Instance Storage/ {print $1; exit}')"
if [[ -z "$DISK" ]]; then
  echo "No instance-store disk found: pick an instance type with local NVMe, such as r6id.8xlarge." >&2
  exit 1
fi
if ! mountpoint -q "$SCRATCH"; then
  sudo mkfs.ext4 -q -F "$DISK"
  sudo mkdir -p "$SCRATCH"
  sudo mount "$DISK" "$SCRATCH"
  sudo chown "$USER" "$SCRATCH"
fi

sudo apt-get update -q
sudo apt-get install -yq python3-venv
python3 -m venv "$SCRATCH/venv"
"$SCRATCH/venv/bin/pip" install -q -r "$PIPELINE_DIR/requirements.txt"

"$SCRATCH/venv/bin/python" "$PIPELINE_DIR/bake_cubes.py" \
  --out "$SCRATCH/cubes" --work "$SCRATCH/work" --region us-east-1 ${PARTS:+--parts "$PARTS"}
"$SCRATCH/venv/bin/python" "$PIPELINE_DIR/upload_cubes.py" --out "$SCRATCH/cubes" --repo "$HF_REPO"

if [[ "${POWER_OFF:-1}" == 1 ]]; then
  sudo shutdown -h now
fi
