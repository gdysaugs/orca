# WAN LoRA orca addons

This image extends:

`suarez123/wan22-i2v:wan22-lora-pack-20260402-001955-libx264`

It copies LoRA files from the Windows Downloads folder through a named build context, so the large `.safetensors` files are not stored in this repository.

## Base Orca LoRA Image

This tag contains the Orca LoRA/model additions. Build it only when the LoRA files change.

```bash
cd /home/adama/orcaai/runpod-worker-wan-lora-orca-addons
DOCKER_BUILDKIT=1 docker build \
  --build-context downloads=/mnt/c/Users/adama/Downloads \
  -t suarez123/wan22-i2v:wan22-lora-pack-orca-addons-20260614 .
```

## Working SageAttention Setup

The working SageAttention route is not the source build and not the generic Linux wheel.
It keeps the existing Orca model/LoRA image as the base, then changes only the Python GPU stack:

- Base image: `suarez123/wan22-i2v:wan22-lora-pack-orca-addons-20260614`
- PyTorch: `torch==2.10.0+cu130`
- TorchVision: `torchvision==0.25.0+cu130`
- TorchAudio: `torchaudio==2.10.0+cu130`
- SageAttention wheel: UmeAiRT `whl/sm89/sageattention-2.2.0-cp312-cp312-linux_x86_64.whl`
- Wheel SHA256: `1b7312158c9b179a6235798c43303d9a01b6ccecdc442c019f7fe26bd7f00213`
- ComfyUI flag: `--use-sage-attention`
- RunPod Minimum CUDA: `13.0`

Models and LoRAs do not need to be downloaded again because this Dockerfile uses the Orca LoRA image as `FROM`.

```bash
cd /home/adama/orcaai/runpod-worker-wan-lora-orca-addons
DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  -f Dockerfile.sage-sm89-torch-cu130 \
  -t suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage-sm89-torch-cu130-20260614 .
```

Push:

```bash
docker push suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage-sm89-torch-cu130-20260614
```

Use this image in RunPod:

```text
suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage-sm89-torch-cu130-20260614
```

Required RunPod setting:

```text
Minimum CUDA: 13.0
```

Successful log markers:

```text
pytorch version: 2.10.0+cu130
Device: cuda:0 NVIDIA GeForce RTX 4090
Using sage attention
Prompt executed in 25.77 seconds
Finished.
```

The successful test did not show:

```text
Error running sage attention
CUDA error: no kernel image is available for execution on the device
using pytorch attention instead
```

If the log says the NVIDIA driver is too old and reports driver version `12080`, the worker is still on a CUDA 12.8 host. Set RunPod Minimum CUDA to `13.0` and restart/redeploy the worker.

## Failed Or Not Recommended Sage Attempts

### Generic SageAttention 2.2 wheel

This tag installs Kijai's generic Linux `sageattention-2.2.0-cp312-cp312-linux_x86_64.whl` plus gcc/Python headers.

```bash
cd /home/adama/orcaai/runpod-worker-wan-lora-orca-addons
DOCKER_BUILDKIT=1 docker build \
  -f Dockerfile.sage2 \
  -t suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage2-gcc-pydev-20260614 .
```

This failed on RTX 4090 with:

```text
CUDA error: no kernel image is available for execution on the device
```

### SageAttention Ada/sm89 source build

```bash
cd /home/adama/orcaai/runpod-worker-wan-lora-orca-addons
DOCKER_BUILDKIT=1 docker build \
  --progress=plain \
  -f Dockerfile.sage-ada \
  -t suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage-ada-sm89only-cu128-retry1-20260614 .
```

This keeps `torch==2.10.0+cu128` and tries to build `fblissjr/SageAttention-ada` with:

```text
TORCH_CUDA_ARCH_LIST=8.9
CUDA_HOME=/usr/local/cuda-12.8
```

It is theoretically the cleanest cu128 route, but the build was too slow or stalled in the CUDA extension build step.

### sm89 wheel with only CUDA 13 runtime added

```bash
cd /home/adama/orcaai/runpod-worker-wan-lora-orca-addons
DOCKER_BUILDKIT=1 docker build \
  -f Dockerfile.sage-sm89-wheel \
  -t suarez123/wan22-i2v:wan22-lora-pack-orca-addons-sage-sm89-wheel-cu13rt-20260614 .
```

This installs the UmeAiRT sm89 wheel and `cuda-cudart-13-0` while keeping `torch==2.10.0+cu128`.
It can import, but failed at runtime on RTX 4090 with:

```text
CUDA error: no kernel image is available for execution on the device
```

The fix was to also move PyTorch to `torch==2.10.0+cu130`, which is documented in the working setup above.
