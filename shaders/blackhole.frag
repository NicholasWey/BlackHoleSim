#version 330 core

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;

uniform vec3 u_cam_pos;
uniform vec3 u_cam_forward;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform float u_fov_y;

uniform float u_black_hole_radius;
uniform float u_disk_inner_radius;
uniform float u_disk_outer_radius;
uniform float u_disk_half_thickness;
uniform float u_step_size;
uniform int u_max_steps;
uniform float u_exposure;
uniform float u_far_distance;
uniform int u_show_grid;
uniform float u_grid_height;
uniform float u_grid_depth;
uniform float u_grid_extent;
uniform float u_grid_spacing;
uniform float u_grid_line_width;
uniform float u_grid_glow;
uniform vec3 u_sun_position;
uniform float u_sun_radius;
uniform vec3 u_sun_color;
uniform float u_sun_intensity;
uniform int u_voxel_mode;
uniform float u_voxel_size;

const float PI = 3.14159265359;
const int MAX_STEPS = 4096;

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float value_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    float x0 = mix(a, b, f.x);
    float x1 = mix(c, d, f.x);
    return mix(x0, x1, f.y);
}

float voxel_cell_size() {
    return max(u_voxel_size, 0.08);
}

vec2 voxel_snap2(vec2 p) {
    float s = voxel_cell_size();
    return floor(p / s + 0.5) * s;
}

vec3 voxel_snap3(vec3 p) {
    float s = voxel_cell_size();
    return floor(p / s + 0.5) * s;
}

vec3 voxel_palette(vec3 c, float levels) {
    float lv = max(levels, 2.0);
    return floor(c * lv + 0.5) / lv;
}

vec3 voxel_normal(vec3 n) {
    vec3 a = abs(n);
    if (a.x >= a.y && a.x >= a.z) {
        return vec3(sign(n.x), 0.0, 0.0);
    }
    if (a.y >= a.x && a.y >= a.z) {
        return vec3(0.0, sign(n.y), 0.0);
    }
    return vec3(0.0, 0.0, sign(n.z));
}

bool intersect_sphere_segment(vec3 p0, vec3 p1, vec3 center, float radius, out float t_hit) {
    vec3 seg = p1 - p0;
    vec3 oc = p0 - center;
    float a = dot(seg, seg);
    if (a <= 1e-8) {
        return false;
    }
    float b = 2.0 * dot(oc, seg);
    float c = dot(oc, oc) - radius * radius;
    float disc = b * b - 4.0 * a * c;
    if (disc < 0.0) {
        return false;
    }

    float s = sqrt(disc);
    float inv_2a = 0.5 / a;
    float t0 = (-b - s) * inv_2a;
    float t1 = (-b + s) * inv_2a;

    float t = 2.0;
    if (t0 >= 0.0 && t0 <= 1.0) {
        t = t0;
    } else if (t1 >= 0.0 && t1 <= 1.0) {
        t = t1;
    }
    if (t > 1.0) {
        return false;
    }
    t_hit = t;
    return true;
}

vec3 sun_emission(vec3 hit_pos) {
    vec3 sample_hit = hit_pos;
    if (u_voxel_mode == 1) {
        sample_hit = u_sun_position + voxel_snap3(hit_pos - u_sun_position);
    }

    vec3 delta = sample_hit - u_sun_position;
    if (dot(delta, delta) < 1e-8) {
        delta = vec3(0.0, 1.0, 0.0);
    }
    vec3 n = normalize(delta);
    if (u_voxel_mode == 1) {
        n = voxel_normal(n);
    }

    float gran_scale = u_voxel_mode == 1 ? 9.0 : 18.0;
    float gran = value_noise(n.xz * gran_scale + n.y * (gran_scale * 0.6));
    vec3 core = mix(vec3(1.0, 0.82, 0.56), u_sun_color, 0.78);
    vec3 surface = core * (0.95 + 0.10 * gran);
    vec3 col = surface * u_sun_intensity;
    if (u_voxel_mode == 1) {
        col = voxel_palette(col, 7.0);
    }
    return col;
}

float disk_grain(vec2 xz) {
    vec2 p = xz * 3.5;
    float n1 = value_noise(p);
    float n2 = value_noise(p * 2.4 + vec2(17.0, 31.0));
    return 0.65 * n1 + 0.35 * n2;
}

vec3 disk_emission(vec3 hit_pos, vec3 view_dir, float rs) {
    vec3 sample_hit = hit_pos;
    if (u_voxel_mode == 1) {
        sample_hit = voxel_snap3(hit_pos);
    }

    float r = length(sample_hit.xz);
    float t = clamp((r - u_disk_inner_radius) / (u_disk_outer_radius - u_disk_inner_radius), 0.0, 1.0);

    vec3 hot = vec3(1.0, 0.94, 0.84);
    vec3 warm = vec3(1.0, 0.52, 0.14);
    vec3 cool = vec3(0.82, 0.12, 0.02);
    vec3 base_col = mix(hot, warm, smoothstep(0.0, 0.36, t));
    base_col = mix(base_col, cool, smoothstep(0.36, 1.0, t));

    float grain = disk_grain(sample_hit.xz);
    float h = max(u_disk_half_thickness, 1e-4);
    float y_norm = abs(sample_hit.y) / h;
    float vertical = exp(-2.6 * y_norm * y_norm);
    float emissive = mix(3.6, 0.55, t) * (0.92 + 0.16 * grain) * vertical;

    float beta = sqrt(clamp(rs / (2.0 * max(r, rs * 1.02)), 0.0, 0.35));
    vec3 tangent = normalize(vec3(-sample_hit.z, 0.0, sample_hit.x));
    vec3 vel = tangent * beta;
    float gamma = inversesqrt(max(1e-4, 1.0 - dot(vel, vel)));
    float doppler = 1.0 / (gamma * (1.0 - dot(vel, -view_dir)));
    doppler = clamp(doppler, 0.28, 2.6);

    float grav = sqrt(max(0.015, 1.0 - rs / max(r, rs * 1.01)));
    float gain = emissive * grav * pow(doppler, 3.0);

    vec3 col = base_col * gain;
    if (u_voxel_mode == 1) {
        col = voxel_palette(col, 6.0);
    }
    return col;
}

vec3 geodesic_accel(vec3 p, vec3 d, float rs) {
    float r = length(p);
    vec3 L = cross(p, d);
    float h2 = dot(L, L);
    float inv_r = 1.0 / max(r, 1e-4);
    float inv_r5 = inv_r * inv_r * inv_r * inv_r * inv_r;
    return -1.5 * rs * h2 * inv_r5 * p;
}

float adaptive_step_size(float r, float rs) {
    // Single stable stepping model for all zoom levels.
    float near_refine = mix(0.24, 1.0, smoothstep(rs * 1.1, rs * 14.0, r));
    float travel_scale = clamp(1.0 + 0.035 * r, 1.0, 40.0);
    return u_step_size * near_refine * travel_scale;
}

float well_surface_y(vec2 xz, float rs) {
    vec2 eval_xz = xz;
    if (u_voxel_mode == 1) {
        eval_xz = voxel_snap2(eval_xz);
    }

    float r = length(eval_xz);
    float edge = max(u_grid_extent, rs * 2.5);
    float r_floor = rs * 1.08;
    float r_safe = max(r, r_floor);
    float depth = u_grid_depth * max(0.0, inversesqrt(r_safe + 0.35) - inversesqrt(edge + 0.35));
    float y = u_grid_height - depth;
    if (u_voxel_mode == 1) {
        float y_step = max(0.08, voxel_cell_size() * 0.65);
        y = floor(y / y_step + 0.5) * y_step;
    }
    return y;
}

float well_slope_dr(float r, float rs) {
    float edge = max(u_grid_extent, rs * 2.5);
    float r_floor = rs * 1.08;
    if (r <= r_floor || r >= edge) {
        return 0.0;
    }
    return 0.5 * u_grid_depth * pow(r + 0.35, -1.5);
}

vec3 well_normal(vec3 p, float rs) {
    if (u_voxel_mode == 1) {
        float eps = max(0.12, voxel_cell_size() * 0.6);
        float yxp = well_surface_y(p.xz + vec2(eps, 0.0), rs);
        float yxn = well_surface_y(p.xz - vec2(eps, 0.0), rs);
        float yzp = well_surface_y(p.xz + vec2(0.0, eps), rs);
        float yzn = well_surface_y(p.xz - vec2(0.0, eps), rs);
        vec3 n = normalize(vec3(-(yxp - yxn), 2.0 * eps, -(yzp - yzn)));
        return voxel_normal(n);
    }

    float r = length(p.xz);
    float slope = well_slope_dr(r, rs);
    if (r < 1e-4 || slope <= 0.0) {
        return vec3(0.0, 1.0, 0.0);
    }
    vec2 radial = p.xz / r;
    return normalize(vec3(-slope * radial.x, 1.0, -slope * radial.y));
}

float square_grid(vec2 p, float spacing, float width) {
    vec2 g = abs(fract(p / spacing + 0.5) - 0.5) * spacing;
    float line = min(g.x, g.y);
    return 1.0 - smoothstep(width, width * 1.8, line);
}

vec3 well_grid_emission(vec3 hit_pos, vec3 view_dir, float rs) {
    vec3 sample_hit = hit_pos;
    if (u_voxel_mode == 1) {
        sample_hit = voxel_snap3(hit_pos);
        sample_hit.y = well_surface_y(sample_hit.xz, rs);
    }

    float r = length(sample_hit.xz);
    if (r <= rs * 1.08 || r >= u_grid_extent) {
        return vec3(0.0);
    }

    float spacing = max(0.1, u_grid_spacing);
    float width = max(0.012, u_grid_line_width);
    if (u_voxel_mode == 1) {
        spacing = max(spacing, voxel_cell_size() * 1.5);
        width = max(width * 0.55, voxel_cell_size() * 0.055);
    }

    float minor = square_grid(sample_hit.xz, spacing, width);
    float major = square_grid(sample_hit.xz, spacing * 5.0, width * 1.6);

    float line = max(minor * 0.55, major * 1.25);
    if (u_voxel_mode == 1) {
        line = max(minor * 0.45, major * 0.90);
    }
    line = clamp(line, 0.0, 1.0);

    vec3 normal = well_normal(sample_hit, rs);
    vec3 light_dir = normalize(vec3(-0.4, 1.0, -0.28));
    float lambert = 0.22 + 0.78 * max(dot(normal, light_dir), 0.0);
    float rim = pow(clamp(1.0 - dot(normal, -view_dir), 0.0, 1.0), 2.0);
    float horizon_fade = 0.45 + 0.55 * (1.0 - smoothstep(u_grid_extent * 0.92, u_grid_extent, r));
    float grav = sqrt(max(0.06, 1.0 - rs / max(r, rs * 1.01)));

    vec3 inner = vec3(0.24, 0.95, 1.0);
    vec3 outer = vec3(0.05, 0.22, 0.38);
    vec3 base_col = mix(inner, outer, smoothstep(rs * 1.4, u_grid_extent, r));
    if (u_voxel_mode == 1) {
        base_col = voxel_palette(base_col, 6.0);
    }

    float intensity = u_grid_glow * line * lambert * (0.82 + 0.72 * rim) * horizon_fade * grav;
    return base_col * intensity;
}

vec3 trace_black_hole(vec3 origin, vec3 ray_dir) {
    vec3 pos = origin;
    vec3 dir = normalize(ray_dir);
    vec3 accum = vec3(0.0);
    float rs = u_black_hole_radius;

    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= u_max_steps) {
            break;
        }

        float r = length(pos);
        if (r <= rs) {
            return accum;
        }
        if (r > u_far_distance) {
            break;
        }

        float local_step = adaptive_step_size(r, rs);
        int sub_steps = 1;
        if (r < rs * 8.0) {
            sub_steps = 3;
        } else if (r < rs * 20.0) {
            sub_steps = 2;
        }
        float dt = local_step / float(sub_steps);
        bool stop_trace = false;

        for (int sub = 0; sub < 3; sub++) {
            if (sub >= sub_steps) {
                break;
            }

            vec3 prev_pos = pos;

            vec3 accel0 = geodesic_accel(pos, dir, rs);
            vec3 dir_mid = normalize(dir + accel0 * (0.5 * dt));
            vec3 pos_mid = pos + dir * (0.5 * dt);
            vec3 accel_mid = geodesic_accel(pos_mid, dir_mid, rs);

            dir = normalize(dir + accel_mid * dt);
            pos += dir_mid * dt;

            if (u_show_grid == 1) {
                float prev_d = prev_pos.y - well_surface_y(prev_pos.xz, rs);
                float curr_d = pos.y - well_surface_y(pos.xz, rs);
                bool crossed_well = (prev_d <= 0.0 && curr_d > 0.0) || (prev_d >= 0.0 && curr_d < 0.0);
                if (crossed_well) {
                    float denom = prev_d - curr_d;
                    float t = abs(denom) > 1e-5 ? prev_d / denom : 0.0;
                    t = clamp(t, 0.0, 1.0);
                    vec3 hit = mix(prev_pos, pos, t);

                    float hit_r = length(hit.xz);
                    if (hit_r > rs * 1.08 && hit_r < u_grid_extent) {
                        vec3 emit = well_grid_emission(hit, dir, rs);
                        accum += emit;
                    }
                }
            }

            float disk_h = max(u_disk_half_thickness, 1e-4);
            float y0 = prev_pos.y;
            float y1 = pos.y;
            float dy = y1 - y0;

            float t0 = 0.0;
            float t1 = 1.0;
            bool slab_hit = false;
            if (abs(dy) < 1e-6) {
                slab_hit = abs(y0) <= disk_h;
            } else {
                float ta = (-disk_h - y0) / dy;
                float tb = (disk_h - y0) / dy;
                t0 = max(0.0, min(ta, tb));
                t1 = min(1.0, max(ta, tb));
                slab_hit = t1 >= t0;
            }

            if (slab_hit) {
                float t_mid = 0.5 * (t0 + t1);
                vec3 hit = mix(prev_pos, pos, t_mid);
                float disk_r = length(hit.xz);
                if (disk_r > u_disk_inner_radius && disk_r < u_disk_outer_radius) {
                    float seg_len = length(pos - prev_pos);
                    float path_frac = max(0.0, t1 - t0);
                    float volume_weight = clamp(path_frac * seg_len / max(disk_h * 0.75, 1e-4), 0.0, 1.4);
                    vec3 emit = disk_emission(hit, dir, rs);
                    accum += emit * volume_weight;
                }
            }

            float sun_t = 0.0;
            if (intersect_sphere_segment(prev_pos, pos, u_sun_position, u_sun_radius, sun_t)) {
                vec3 sun_hit = mix(prev_pos, pos, sun_t);
                accum += sun_emission(sun_hit);
                return accum;
            }

            if (length(pos) > u_far_distance) {
                stop_trace = true;
                break;
            }
            if (length(pos) <= rs) {
                return accum;
            }
        }
        if (stop_trace) {
            break;
        }
    }

    return accum;
}

void main() {
    vec2 ndc = (gl_FragCoord.xy / u_resolution) * 2.0 - 1.0;
    ndc.x *= u_resolution.x / u_resolution.y;

    float tan_half_fov = tan(0.5 * u_fov_y);
    vec3 ray_dir = normalize(
        u_cam_forward
        + ndc.x * tan_half_fov * u_cam_right
        + ndc.y * tan_half_fov * u_cam_up
    );

    vec3 color = trace_black_hole(u_cam_pos, ray_dir);
    color = vec3(1.0) - exp(-color * u_exposure);
    color = pow(color, vec3(1.0 / 2.2));

    fragColor = vec4(color, 1.0);
}
