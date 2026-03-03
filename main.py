from __future__ import annotations

import math
from pathlib import Path
from typing import Any, SupportsInt, cast

import moderngl
import moderngl_window as mglw
from moderngl_window.context.base import WindowConfig
import numpy as np


def normalize(v: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(v))
    if length < 1e-8:
        return v
    return v / length


class BlackHoleSim(WindowConfig):
    gl_version = (3, 3)
    title = "Black Hole Sim (GPU Raytracing)"
    window_size = (1600, 900)
    resizable = True
    aspect_ratio = None
    vsync = True

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)

        shader_dir = Path(__file__).resolve().parent / "shaders"
        self.program = self.ctx.program(
            vertex_shader=(shader_dir / "fullscreen.vert").read_text(encoding="utf-8"),
            fragment_shader=(shader_dir / "blackhole.frag").read_text(encoding="utf-8"),
        )
        self.quad = self.ctx.vertex_array(self.program, [])

        self.target = np.array([0.0, 0.0, 0.0], dtype=np.float32)
        self.yaw = math.radians(215.0)
        self.pitch = math.radians(-6.0)
        self.radius = 16.0
        self.zoom_reference_radius = self.radius
        self.fov_y = math.radians(55.0)

        self.black_hole_radius = 1.0
        self.spinning_mode = False
        self.black_hole_spin = 0.38
        self.disk_inner_radius = 1.58
        self.disk_outer_radius = 6.95
        self.disk_half_thickness = 0.17
        self.exposure = 1.52
        self.far_distance = 2200.0
        self.zoom_far_distance_scale = 34.0
        self.max_ray_steps_cap = 3072
        self.show_grid = False
        self.grid_height = -2.9
        self.grid_depth = 20.0
        self.grid_extent = 52.0
        self.grid_spacing = 1.6
        self.grid_line_width = 0.055
        self.grid_glow = 2.15
        self.sun_position = np.array([22.0, 10.0, 13.0], dtype=np.float32)
        self.sun_radius = 5.2
        self.sun_color = np.array([1.0, 0.68, 0.84], dtype=np.float32)
        self.sun_intensity = 7.4
        self.voxel_mode = False
        self.voxel_size = 0.28

        self._time = 0.0
        self._paused = False

        self.quality_presets = {
            "1": {"name": "performance", "step_size": 0.08, "max_steps": 600},
            "2": {"name": "balanced", "step_size": 0.06, "max_steps": 760},
            "3": {"name": "cinematic", "step_size": 0.045, "max_steps": 960},
        }
        self._set_quality("2")

        keys = self.wnd.keys
        print("Controls:")
        print("  Left mouse drag: orbit camera")
        print("  Mouse wheel: zoom")
        print("  1/2/3: quality preset")
        print("  B: toggle spinning black hole mode")
        print("  G: toggle gravity well grid")
        print("  V: toggle voxel mode")
        print("  Space: pause time")
        print(f"  Esc: quit ({keys.ESCAPE})")

    def _is_action_press(self, action: object) -> bool:
        keys = self.wnd.keys
        press = getattr(keys, "ACTION_PRESS", None)
        if action == press:
            return True
        if isinstance(action, str) and action.upper() == "ACTION_PRESS":
            return True
        if isinstance(action, int):
            return action == 1
        if isinstance(action, SupportsInt):
            try:
                return int(cast(SupportsInt, action)) == 1
            except (TypeError, ValueError):
                return False
        return False

    def _key_candidates(self, *names: str, fallback: int | None = None) -> tuple[object, ...]:
        keys = self.wnd.keys
        out: list[object] = []
        for name in names:
            value = getattr(keys, name, None)
            if value is None or value == "undefined":
                continue
            out.append(value)
        if fallback is not None:
            out.append(fallback)
        return tuple(out)

    def _set_quality(self, level: str) -> None:
        preset = self.quality_presets[level]
        self.step_size = float(preset["step_size"])
        self.max_steps = int(preset["max_steps"])
        self.quality_name = str(preset["name"])
        print(
            f"Quality preset: {self.quality_name} "
            f"(step_size={self.step_size}, max_steps={self.max_steps})"
        )

    def _set_uniform(self, name: str, value: Any) -> None:
        # moderngl Program indexing is dynamically typed; cast to Any for static checkers.
        cast(Any, self.program[name]).value = value

    def _distance_budget(self) -> tuple[float, int]:
        base_far = self.far_distance
        ref_radius = max(self.zoom_reference_radius, 1e-6)
        extra_radius = max(0.0, self.radius - ref_radius)
        dynamic_far = base_far + extra_radius * self.zoom_far_distance_scale

        far_ratio = dynamic_far / base_far if base_far > 1e-6 else 1.0
        dynamic_max_steps = int(
            np.clip(
                math.ceil(self.max_steps * far_ratio),
                self.max_steps,
                self.max_ray_steps_cap,
            )
        )
        return dynamic_far, dynamic_max_steps

    def _camera_vectors(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        cp = math.cos(self.pitch)
        sp = math.sin(self.pitch)
        cy = math.cos(self.yaw)
        sy = math.sin(self.yaw)

        camera_pos = np.array(
            [
                self.target[0] + self.radius * cp * cy,
                self.target[1] + self.radius * sp,
                self.target[2] + self.radius * cp * sy,
            ],
            dtype=np.float32,
        )

        forward = normalize(self.target - camera_pos)
        world_up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        right = normalize(np.cross(forward, world_up))
        if float(np.linalg.norm(right)) < 1e-6:
            right = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        up = normalize(np.cross(right, forward))
        return camera_pos, forward, right, up

    def on_render(self, time: float, frame_time: float) -> None:
        if not self._paused:
            self._time += frame_time

        camera_pos, forward, right, up = self._camera_vectors()

        width, height = self.wnd.buffer_size
        if width <= 0 or height <= 0:
            return
        self.ctx.viewport = (0, 0, width, height)
        self.ctx.disable(moderngl.DEPTH_TEST)

        self._set_uniform("u_resolution", (float(width), float(height)))
        try:
            self._set_uniform("u_time", self._time)
        except KeyError:
            pass
        self._set_uniform("u_cam_pos", tuple(float(v) for v in camera_pos))
        self._set_uniform("u_cam_forward", tuple(float(v) for v in forward))
        self._set_uniform("u_cam_right", tuple(float(v) for v in right))
        self._set_uniform("u_cam_up", tuple(float(v) for v in up))
        self._set_uniform("u_fov_y", self.fov_y)
        self._set_uniform("u_black_hole_radius", self.black_hole_radius)
        self._set_uniform(
            "u_black_hole_spin",
            self.black_hole_spin if self.spinning_mode else 0.0
        )
        self._set_uniform("u_disk_inner_radius", self.disk_inner_radius)
        self._set_uniform("u_disk_outer_radius", self.disk_outer_radius)
        self._set_uniform("u_disk_half_thickness", self.disk_half_thickness)

        self._set_uniform("u_step_size", self.step_size)
        far_distance, max_steps = self._distance_budget()
        self._set_uniform("u_max_steps", max_steps)
        self._set_uniform("u_exposure", self.exposure)
        self._set_uniform("u_far_distance", far_distance)
        self._set_uniform("u_show_grid", int(self.show_grid))
        self._set_uniform("u_grid_height", self.grid_height)
        self._set_uniform("u_grid_depth", self.grid_depth)
        self._set_uniform("u_grid_extent", self.grid_extent)
        self._set_uniform("u_grid_spacing", self.grid_spacing)
        self._set_uniform("u_grid_line_width", self.grid_line_width)
        self._set_uniform("u_grid_glow", self.grid_glow)
        self._set_uniform("u_sun_position", tuple(float(v) for v in self.sun_position))
        self._set_uniform("u_sun_radius", self.sun_radius)
        self._set_uniform("u_sun_color", tuple(float(v) for v in self.sun_color))
        self._set_uniform("u_sun_intensity", self.sun_intensity)
        self._set_uniform("u_voxel_mode", int(self.voxel_mode))
        self._set_uniform("u_voxel_size", self.voxel_size)

        self.quad.render(mode=moderngl.TRIANGLES, vertices=3)

    # Compatibility for versions that still call render() directly.
    def render(self, time: float, frame_time: float) -> None:
        self.on_render(time, frame_time)

    def on_mouse_drag_event(self, x: int, y: int, dx: int, dy: int, *extra: object) -> None:
        del extra
        del x, y
        sensitivity = 0.0038
        self.yaw += dx * sensitivity
        self.pitch = float(
            np.clip(self.pitch - dy * sensitivity, -math.radians(88.0), math.radians(88.0))
        )

    def on_mouse_scroll_event(
        self, x_offset: float, y_offset: float, *extra: object
    ) -> None:
        del extra
        del x_offset
        zoom_scale = math.exp(-y_offset * 0.12)
        self.radius = float(np.clip(self.radius * zoom_scale, 3.0, 180.0))

    def on_key_event(self, key: object, action: object, modifiers: object, *extra: object) -> None:
        del extra
        del modifiers
        if not self._is_action_press(action):
            return

        esc_keys = self._key_candidates("ESCAPE")
        if key in esc_keys:
            self.wnd.close()
            return

        space_keys = self._key_candidates("SPACE", fallback=32)
        if key in space_keys:
            self._paused = not self._paused
            print("Time paused" if self._paused else "Time running")
            return

        g_keys = self._key_candidates("G", fallback=ord("g"))
        if key in g_keys:
            self.show_grid = not self.show_grid
            print("Gravity grid enabled" if self.show_grid else "Gravity grid disabled")
            return

        b_keys = self._key_candidates("B", fallback=ord("b"))
        if key in b_keys:
            self.spinning_mode = not self.spinning_mode
            print(
                "Black hole mode: spinning"
                if self.spinning_mode
                else "Black hole mode: static"
            )
            return

        v_keys = self._key_candidates("V", fallback=ord("v"))
        if key in v_keys:
            self.voxel_mode = not self.voxel_mode
            print("Voxel mode enabled" if self.voxel_mode else "Voxel mode disabled")
            return

        num1_keys = self._key_candidates("NUMBER_1", "NUMPAD_1", fallback=49)
        num2_keys = self._key_candidates("NUMBER_2", "NUMPAD_2", fallback=50)
        num3_keys = self._key_candidates("NUMBER_3", "NUMPAD_3", fallback=51)

        if key in num1_keys:
            self._set_quality("1")
        elif key in num2_keys:
            self._set_quality("2")
        elif key in num3_keys:
            self._set_quality("3")

    # Backward-compatibility wrappers for older moderngl-window callback names.
    def mouse_drag_event(self, x: int, y: int, dx: int, dy: int) -> None:
        self.on_mouse_drag_event(x, y, dx, dy)

    def mouse_scroll_event(self, x_offset: float, y_offset: float) -> None:
        self.on_mouse_scroll_event(x_offset, y_offset)

    def key_event(self, key: int, action: int, modifiers: int) -> None:
        self.on_key_event(key, action, modifiers)


if __name__ == "__main__":
    mglw.run_window_config(BlackHoleSim)
