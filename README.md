# BlackHoleSim

Real-time 3D black hole visualization with GPU raytracing and Schwarzschild light bending.

This project runs the ray integration on the GPU in a fragment shader, so your RTX 2070 Super does the heavy work while your Ryzen 7 5800X handles window/input orchestration.

## Physics Model

- Metric: Schwarzschild + stable spin approximation by default
- Optional full Kerr mode: experimental Kerr null geodesic tracing
- Units: `G = c = 1`, with configurable Schwarzschild radius `r_s`
- Light paths: stable real-time approximation by default, optional Kerr BL integration
- Accretion disk:
  - thin disk in the equatorial plane
  - approximate orbital Doppler boosting
  - approximate gravitational redshift dimming

This is physically grounded for visual simulation; radiative and disk appearance terms are still real-time approximations.

## Hardware Fit (Your PC)

Targeted for:
- CPU: Ryzen 7 5800X
- GPU: RTX 2070 Super
- RAM: 32 GB

Default settings are tuned for smooth 1080p rendering on this class of GPU.

## Setup

1. Install Python 3.11+.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run:

```bash
python main.py
```

## Controls

- Left mouse drag: orbit camera
- Mouse wheel: zoom in/out
- `1`: performance preset (fewer integration steps)
- `2`: balanced preset (default)
- `3`: cinematic preset (more integration steps)
- `G`: toggle the gravity-well grid
- `B`: toggle static/spinning black hole mode
- `K`: toggle stable approximation / experimental full Kerr solver
- `V`: toggle voxel mode
- `Space`: pause/resume simulation time
- `Esc`: quit

## Performance Notes

- If frame rate drops, press `1`.
- If you want cleaner lensing detail, press `3`.
- For 1440p/4K, start with preset `1` or `2`.
