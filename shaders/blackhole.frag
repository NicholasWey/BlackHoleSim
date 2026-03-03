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
uniform float u_black_hole_spin;
uniform int u_use_full_kerr;
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
const int PIXEL_PALETTE_SIZE = 8;
const vec3 PIXEL_PALETTE[PIXEL_PALETTE_SIZE] = vec3[](
    vec3(0.050, 0.016, 0.145),
    vec3(0.102, 0.043, 0.247),
    vec3(0.196, 0.078, 0.353),
    vec3(0.420, 0.129, 0.486),
    vec3(0.729, 0.219, 0.580),
    vec3(0.965, 0.438, 0.700),
    vec3(1.000, 0.774, 0.620),
    vec3(1.000, 0.949, 0.865)
);

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float hash31(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float pixel_screen_size() {
    return 6.0;
}

vec3 nearest_pixel_color(vec3 c) {
    vec3 best = PIXEL_PALETTE[0];
    float best_d = 1e9;
    for (int i = 0; i < PIXEL_PALETTE_SIZE; i++) {
        vec3 p = PIXEL_PALETTE[i];
        vec3 d = (c - p) * vec3(1.0, 0.9, 1.1);
        float dist = dot(d, d);
        if (dist < best_d) {
            best_d = dist;
            best = p;
        }
    }
    return best;
}

vec3 banded_pixel_color(float t) {
    if (t > 0.88) {
        return PIXEL_PALETTE[7];
    }
    if (t > 0.72) {
        return PIXEL_PALETTE[6];
    }
    if (t > 0.55) {
        return PIXEL_PALETTE[5];
    }
    if (t > 0.38) {
        return PIXEL_PALETTE[4];
    }
    if (t > 0.24) {
        return PIXEL_PALETTE[3];
    }
    if (t > 0.12) {
        return PIXEL_PALETTE[2];
    }
    return PIXEL_PALETTE[1];
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

vec2 sky_uv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
}

float star_layer(vec3 dir, float scale, float threshold) {
    vec3 p = floor((dir * 0.5 + 0.5) * scale);
    float n = hash31(p);
    float s = smoothstep(threshold, 1.0, n);
    return pow(s, 10.0);
}

vec3 space_background(vec3 dir) {
    vec2 uv = sky_uv(dir);
    if (u_voxel_mode == 1) {
        float cell = 0.0080 * pixel_screen_size();
        vec2 uv_cell = floor(uv / cell);
        vec2 uv_local = abs(fract(uv / cell) - 0.5);

        float neb_a = value_noise(uv_cell * 0.065);
        float neb_b = value_noise(uv_cell * 0.120 + vec2(41.0, 17.0));
        float neb = smoothstep(0.56, 0.90, 0.62 * neb_a + 0.38 * neb_b);
        vec3 color = mix(PIXEL_PALETTE[0], PIXEL_PALETTE[1], neb * 0.72);

        float cloud_seed = value_noise(uv_cell * vec2(0.11, 0.32) + vec2(13.0, -9.0));
        float cloud = smoothstep(0.74, 0.95, cloud_seed) * 0.45;
        color = mix(color, PIXEL_PALETTE[2], cloud);

        float star_seed = hash21(uv_cell + 19.0);
        float star = step(0.9970, star_seed);
        float big_seed = hash21(uv_cell * 0.37 + 83.0);
        float big_star = step(0.9988, big_seed);
        float cross = max(1.0 - step(0.15, uv_local.x), 1.0 - step(0.15, uv_local.y));
        float sparkle = max(star, big_star * cross);

        vec3 star_col = mix(PIXEL_PALETTE[5], PIXEL_PALETTE[7], hash21(uv_cell * 1.9 + 5.0));
        color += sparkle * star_col * (1.0 + 0.45 * big_star);

        float sky_grad = clamp(0.5 + 0.5 * dir.y, 0.0, 1.0);
        color = mix(color * 0.90, color * 1.08, sky_grad);
        return nearest_pixel_color(color);
    }

    float n0 = value_noise(uv * vec2(16.0, 8.0) + vec2(0.0, u_time * 0.014));
    float n1 = value_noise(uv * vec2(30.0, 15.0) - vec2(u_time * 0.010, 0.0));
    float nebula = smoothstep(0.28, 0.88, 0.62 * n0 + 0.38 * n1);

    vec3 deep = vec3(0.020, 0.008, 0.058);
    vec3 haze = vec3(0.235, 0.055, 0.255);
    vec3 color = mix(deep, haze, nebula * 0.44);

    float horizon = clamp(0.5 + 0.5 * dir.y, 0.0, 1.0);
    color *= mix(0.84, 1.08, pow(horizon, 0.9));

    float stars = 0.0;
    stars += 1.12 * star_layer(dir, 230.0, 0.9968);
    stars += 0.85 * star_layer(normalize(dir + vec3(0.31, -0.22, 0.17)), 520.0, 0.9989);

    float hue_pick = hash31(floor((dir * 0.5 + 0.5) * 390.0));
    vec3 warm_star = vec3(1.00, 0.77, 0.90);
    vec3 pale_star = vec3(1.00, 0.97, 0.93);
    vec3 star_col = mix(warm_star, pale_star, smoothstep(0.12, 0.95, hue_pick));

    float twinkle = 0.90 + 0.10 * sin(u_time * 3.0 + dot(dir, vec3(12.7, 8.1, 19.2)));
    color += stars * twinkle * star_col;
    return color;
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
    vec3 core = mix(vec3(1.0, 0.92, 0.88), u_sun_color, 0.80);
    vec3 surface = core * (0.93 + 0.14 * gran);
    vec3 col = surface * u_sun_intensity;
    if (u_voxel_mode == 1) {
        float edge = clamp(length(sample_hit - u_sun_position) / max(u_sun_radius, 1e-4), 0.0, 1.0);
        float edge_band = floor(edge * 4.0 + 0.5) / 4.0;
        vec3 sun_col = mix(PIXEL_PALETTE[7], PIXEL_PALETTE[6], edge_band);
        float sparkle = step(0.76, gran);
        col = sun_col * (0.36 * u_sun_intensity) * (1.0 + 0.25 * sparkle);
        col = nearest_pixel_color(col);
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

    if (u_voxel_mode == 1) {
        float h = max(u_disk_half_thickness, 1e-4);
        float y_norm = abs(sample_hit.y) / h;
        float slab = 1.0 - step(1.0, y_norm);
        if (slab <= 0.0) {
            return vec3(0.0);
        }

        float band_t = floor(t * 5.0 + 0.5) / 5.0;
        vec3 base_col = banded_pixel_color(1.0 - band_t * 0.95);

        float beta = sqrt(clamp(rs / (2.0 * max(r, rs * 1.02)), 0.0, 0.35));
        vec3 tangent = normalize(vec3(-sample_hit.z, 0.0, sample_hit.x));
        vec3 vel = tangent * beta;
        float gamma = inversesqrt(max(1e-4, 1.0 - dot(vel, vel)));
        float doppler = 1.0 / (gamma * (1.0 - dot(vel, -view_dir)));
        float doppler_q = floor(clamp(doppler, 0.55, 2.2) * 3.0) / 3.0;

        float grav = sqrt(max(0.03, 1.0 - rs / max(r, rs * 1.01)));
        float emit_band = floor((mix(4.8, 0.9, band_t) * 2.0) + 0.5) / 2.0;
        float gain = emit_band * grav * pow(max(0.45, doppler_q), 2.2) * slab;

        vec3 col = base_col * gain;
        float inner = exp(-pow((r - u_disk_inner_radius) / max(0.12, u_disk_inner_radius * 0.18), 2.0));
        float inner_q = floor(inner * 4.0 + 0.5) / 4.0;
        col += PIXEL_PALETTE[7] * inner_q * 1.05;
        return nearest_pixel_color(col);
    }

    vec3 hot = vec3(1.0, 0.95, 0.89);
    vec3 warm = vec3(1.0, 0.53, 0.78);
    vec3 cool = vec3(0.54, 0.16, 0.55);
    vec3 base_col = mix(hot, warm, smoothstep(0.0, 0.34, t));
    base_col = mix(base_col, cool, smoothstep(0.34, 1.0, t));

    float grain = disk_grain(sample_hit.xz);
    float h = max(u_disk_half_thickness, 1e-4);
    float y_norm = abs(sample_hit.y) / h;
    float vertical = exp(-2.2 * y_norm * y_norm);
    float emissive = mix(4.6, 0.72, t) * (0.90 + 0.18 * grain) * vertical;

    float swirl = 0.5 + 0.5 * sin(atan(sample_hit.z, sample_hit.x) * 3.2 - u_time * 0.55 + grain * 3.1);
    base_col *= mix(0.90, 1.18, swirl);

    float beta = sqrt(clamp(rs / (2.0 * max(r, rs * 1.02)), 0.0, 0.35));
    vec3 tangent = normalize(vec3(-sample_hit.z, 0.0, sample_hit.x));
    vec3 vel = tangent * beta;
    float gamma = inversesqrt(max(1e-4, 1.0 - dot(vel, vel)));
    float doppler = 1.0 / (gamma * (1.0 - dot(vel, -view_dir)));
    doppler = clamp(doppler, 0.28, 2.6);

    float grav = sqrt(max(0.015, 1.0 - rs / max(r, rs * 1.01)));
    float gain = emissive * grav * pow(doppler, 2.8);

    vec3 col = base_col * gain;
    float edge_glow = exp(-pow((r - u_disk_inner_radius) / max(0.7, u_disk_inner_radius * 0.42), 2.0));
    col += vec3(1.0, 0.72, 0.88) * edge_glow * 0.44 * vertical;
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
    vec3 accel = -1.5 * rs * h2 * inv_r5 * p;

    // Lightweight Kerr-inspired frame dragging term for spinning mode.
    float spin = u_black_hole_spin;
    if (abs(spin) > 1e-5) {
        vec3 spin_axis = vec3(1.0, 0.0, 0.0);
        float inv_r3 = inv_r * inv_r * inv_r;
        vec3 j = spin_axis * (spin * rs * rs);
        vec3 r_hat = p * inv_r;
        vec3 b = (3.0 * r_hat * dot(j, r_hat) - j) * inv_r3;
        accel += 2.6 * cross(d, b);
    }

    return accel;
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

    vec3 inner = vec3(1.0, 0.58, 0.86);
    vec3 outer = vec3(0.16, 0.06, 0.23);
    vec3 base_col = mix(inner, outer, smoothstep(rs * 1.4, u_grid_extent, r));
    if (u_voxel_mode == 1) {
        base_col = voxel_palette(base_col, 6.0);
    }

    float intensity = u_grid_glow * line * lambert * (0.82 + 0.72 * rim) * horizon_fade * grav;
    return base_col * intensity;
}

vec3 trace_black_hole_approx(vec3 origin, vec3 ray_dir) {
    vec3 pos = origin;
    vec3 dir = normalize(ray_dir);
    vec3 accum = vec3(0.0);
    float rs = u_black_hole_radius;
    float closest_r = length(pos);

    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= u_max_steps) {
            break;
        }

        float r = length(pos);
        closest_r = min(closest_r, r);
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
            closest_r = min(closest_r, length(pos));

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
            if (u_sun_intensity > 0.001
                && intersect_sphere_segment(prev_pos, pos, u_sun_position, u_sun_radius, sun_t)) {
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

    if (u_voxel_mode == 1) {
        vec3 bg = space_background(dir);
        float lens = 1.0 - smoothstep(rs * 2.0, rs * 10.0, closest_r);
        lens = floor(lens * 5.0 + 0.5) / 5.0;

        float ring_mix = clamp((closest_r - rs) / max(rs * 5.0, 1e-4), 0.0, 1.0);
        ring_mix = floor(ring_mix * 5.0 + 0.5) / 5.0;
        vec3 ring_tint = banded_pixel_color(1.0 - ring_mix * 0.90);

        bg *= mix(1.0, 0.35, lens);
        accum += bg;
        accum += ring_tint * lens * 0.95;
        return accum;
    }

    vec3 bg = space_background(dir);
    float lens = 1.0 - smoothstep(rs * 2.0, rs * 11.0, closest_r);
    float ring_mix = clamp((closest_r - rs) / max(rs * 5.0, 1e-4), 0.0, 1.0);
    vec3 ring_tint = mix(vec3(1.0, 0.94, 0.88), vec3(1.0, 0.35, 0.72), ring_mix);
    bg *= mix(1.0, 0.44, lens * 0.82);
    accum += bg;
    accum += ring_tint * pow(lens, 2.1) * 0.78;

    return accum;
}

float safe_sin2(float theta) {
    float s = sin(theta);
    return max(s * s, 1e-6);
}

float kerr_horizon_radius(float rs, float a) {
    float M = 0.5 * rs;
    float a_clamped = clamp(abs(a), 0.0, max(M - 1e-6, 0.0));
    return M + sqrt(max(M * M - a_clamped * a_clamped, 0.0));
}

vec3 world_to_kerr(vec3 p) {
    // Rotate world frame so Kerr spin axis (local +Y) maps to world +X.
    return vec3(p.z, p.x, p.y);
}

vec3 kerr_to_world(vec3 p) {
    return vec3(p.y, p.z, p.x);
}

vec3 bl_to_cart_y_axis(float r, float theta, float phi, float a) {
    float rr = max(r, 1e-4);
    float th = clamp(theta, 1e-4, PI - 1e-4);
    float A = sqrt(rr * rr + a * a);
    float st = sin(th);
    float cp = cos(phi);
    float sp = sin(phi);
    return vec3(A * st * cp, rr * cos(th), A * st * sp);
}

vec3 cart_to_bl_y_axis(vec3 p, float a) {
    float r2_cart = dot(p, p);
    float tmp = r2_cart - a * a;
    float disc = sqrt(max(tmp * tmp + 4.0 * a * a * p.y * p.y, 0.0));
    float r2 = max(0.5 * (tmp + disc), 1e-8);
    float r = sqrt(r2);
    float ct = clamp(p.y / max(r, 1e-6), -1.0, 1.0);
    float theta = acos(ct);
    float phi = atan(p.z, p.x);
    return vec3(r, theta, phi);
}

void bl_basis_y_axis(
    float r,
    float theta,
    float phi,
    float a,
    out vec3 e_r,
    out vec3 e_theta,
    out vec3 e_phi
) {
    float A = sqrt(r * r + a * a);
    float st = sin(theta);
    float ct = cos(theta);
    float cp = cos(phi);
    float sp = sin(phi);
    float r_over_A = r / max(A, 1e-6);

    e_r = vec3(r_over_A * st * cp, ct, r_over_A * st * sp);
    e_theta = vec3(A * ct * cp, -r * st, A * ct * sp);
    e_phi = vec3(-A * st * sp, 0.0, A * st * cp);
}

void kerr_metric_components(
    float r,
    float theta,
    float rs,
    float a,
    out float Sigma,
    out float Delta,
    out float g_tt,
    out float g_tphi,
    out float g_rr,
    out float g_thetatheta,
    out float g_phiphi
) {
    float ct = cos(theta);
    float st2 = safe_sin2(theta);

    Sigma = max(r * r + a * a * ct * ct, 1e-6);
    Delta = r * r - rs * r + a * a;

    g_tt = -(1.0 - rs * r / Sigma);
    g_tphi = -(rs * r * a * st2) / Sigma;
    g_rr = Sigma / max(Delta, 1e-6);
    g_thetatheta = Sigma;
    g_phiphi = st2 * (r * r + a * a + (rs * r * a * a * st2) / Sigma);
}

bool init_kerr_ray(
    vec3 origin,
    vec3 ray_dir,
    float rs,
    float a,
    out vec4 state,
    out vec2 signs,
    out float Lz,
    out float Q
) {
    vec3 origin_kerr = world_to_kerr(origin);
    vec3 dir_kerr = normalize(world_to_kerr(ray_dir));
    vec3 bl = cart_to_bl_y_axis(origin_kerr, a);
    float r = max(bl.x, 1e-4);
    float theta = clamp(bl.y, 1e-4, PI - 1e-4);
    float phi = bl.z;

    vec3 e_r;
    vec3 e_theta;
    vec3 e_phi;
    bl_basis_y_axis(r, theta, phi, a, e_r, e_theta, e_phi);

    vec3 dir = normalize(dir_kerr);
    vec3 u_r = normalize(e_r);
    vec3 u_theta = normalize(e_theta);
    vec3 u_phi = normalize(e_phi);
    vec3 local_dir = vec3(dot(dir, u_r), dot(dir, u_theta), dot(dir, u_phi));
    float local_len = length(local_dir);
    if (local_len < 1e-6) {
        return false;
    }
    local_dir /= local_len;
    float n_r = local_dir.x;
    float n_theta = local_dir.y;
    float n_phi = local_dir.z;

    float Sigma;
    float Delta;
    float g_tt;
    float g_tphi;
    float g_rr;
    float g_thetatheta;
    float g_phiphi;
    kerr_metric_components(
        r,
        theta,
        rs,
        a,
        Sigma,
        Delta,
        g_tt,
        g_tphi,
        g_rr,
        g_thetatheta,
        g_phiphi
    );

    float st2 = safe_sin2(theta);
    float A_big = (r * r + a * a) * (r * r + a * a) - a * a * Delta * st2;
    float A_safe = max(A_big, 1e-6);
    float alpha = sqrt(max(Sigma * max(Delta, 1e-8) / A_safe, 1e-8));
    float omega = (a * rs * r) / A_safe;

    // Initialize photon 4-momentum in a local orthonormal frame (ZAMO-like).
    float t_dot = 1.0 / alpha;
    float r_dot = n_r * sqrt(max(Delta, 1e-8) / Sigma);
    float theta_dot = n_theta / sqrt(max(Sigma, 1e-8));
    float phi_dot = omega / alpha + n_phi * sqrt(max(Sigma / A_safe, 1e-8)) / sqrt(st2);

    float p_t = g_tt * t_dot + g_tphi * phi_dot;
    float E = -p_t;
    if (E <= 1e-6) {
        return false;
    }

    float inv_E = 1.0 / E;
    r_dot *= inv_E;
    theta_dot *= inv_E;
    phi_dot *= inv_E;
    t_dot *= inv_E;

    Lz = g_tphi * t_dot + g_phiphi * phi_dot;

    float ct = cos(theta);
    float p_theta = g_thetatheta * theta_dot;
    Q = p_theta * p_theta + ct * ct * (Lz * Lz / st2 - a * a);
    // Numerical guard: tiny negative Carter values near the image midline can
    // cause branch-flip seams and duplicated images.
    Q = max(Q, 0.0);

    float sign_r = r_dot >= 0.0 ? 1.0 : -1.0;
    float sign_theta = theta_dot >= 0.0 ? 1.0 : -1.0;
    if (abs(r_dot) < 1e-7) {
        sign_r = 1.0;
    }
    if (abs(theta_dot) < 1e-7) {
        sign_theta = 1.0;
    }

    state = vec4(r, theta, phi, 0.0);
    signs = vec2(sign_r, sign_theta);
    return true;
}

void kerr_invariants(
    float r,
    float theta,
    float Lz,
    float Q,
    float rs,
    float a,
    out float Sigma,
    out float Delta,
    out float P,
    out float R,
    out float Theta
) {
    float ct = cos(theta);
    float st2 = safe_sin2(theta);

    Sigma = max(r * r + a * a * ct * ct, 1e-6);
    Delta = r * r - rs * r + a * a;
    P = r * r + a * a - a * Lz;

    float radial_term = Q + (Lz - a) * (Lz - a);
    R = P * P - Delta * radial_term;

    Theta = Q + a * a * ct * ct - (Lz * Lz * ct * ct) / st2;
}

void kerr_derivatives(
    vec4 state,
    vec2 signs,
    float Lz,
    float Q,
    float rs,
    float a,
    out vec4 deriv,
    out float R,
    out float Theta
) {
    float r = max(state.x, 1e-4);
    float theta = clamp(state.y, 1e-4, PI - 1e-4);

    float Sigma;
    float Delta;
    float P;
    kerr_invariants(r, theta, Lz, Q, rs, a, Sigma, Delta, P, R, Theta);

    float st2 = safe_sin2(theta);
    float delta_safe = max(Delta, 1e-6);
    float r_dot = signs.x * sqrt(max(R, 0.0)) / Sigma;
    float theta_dot = signs.y * sqrt(max(Theta, 0.0)) / Sigma;
    float phi_dot = (a * P / delta_safe + (Lz / st2 - a)) / Sigma;
    float t_dot = (((r * r + a * a) * P) / delta_safe + a * (Lz - a * st2)) / Sigma;

    deriv = vec4(r_dot, theta_dot, phi_dot, t_dot);
}

void advance_kerr_ray(
    inout vec4 state,
    inout vec2 signs,
    float Lz,
    float Q,
    float rs,
    float a,
    float h
) {
    vec4 k1;
    float R1;
    float Theta1;
    kerr_derivatives(state, signs, Lz, Q, rs, a, k1, R1, Theta1);

    vec4 mid = state + 0.5 * h * k1;
    mid.x = max(mid.x, 1e-4);
    mid.y = clamp(mid.y, 1e-4, PI - 1e-4);

    vec4 k2;
    float R2;
    float Theta2;
    kerr_derivatives(mid, signs, Lz, Q, rs, a, k2, R2, Theta2);

    state += h * k2;
    state.x = max(state.x, 1e-4);
    state.y = clamp(state.y, 1e-4, PI - 1e-4);
    state.z = atan(sin(state.z), cos(state.z));

    float SigmaN;
    float DeltaN;
    float PN;
    float RN;
    float ThetaN;
    kerr_invariants(state.x, state.y, Lz, Q, rs, a, SigmaN, DeltaN, PN, RN, ThetaN);

    const float TURN_EPS = 1e-6;
    if (RN < -TURN_EPS) {
        signs.x *= -1.0;
    }
    if (ThetaN < -TURN_EPS) {
        signs.y *= -1.0;
    }
}

vec3 trace_black_hole(vec3 origin, vec3 ray_dir) {
    float rs = u_black_hole_radius;
    float M = 0.5 * rs;
    float spin_star = clamp(u_black_hole_spin, -0.999, 0.999);
    float a = spin_star * M;

    // Default to stable approximation unless full Kerr is explicitly enabled.
    if (u_use_full_kerr == 0 || abs(a) < 1e-6) {
        return trace_black_hole_approx(origin, ray_dir);
    }

    vec4 state;
    vec2 signs;
    float Lz = 0.0;
    float Q = 0.0;
    if (!init_kerr_ray(origin, ray_dir, rs, a, state, signs, Lz, Q)) {
        return trace_black_hole_approx(origin, ray_dir);
    }

    float horizon = kerr_horizon_radius(rs, a);
    float horizon_guard = horizon + 0.02 * rs;
    vec3 accum = vec3(0.0);
    vec3 pos = origin;
    vec3 dir = normalize(ray_dir);
    float closest_r = length(pos);

    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= u_max_steps) {
            break;
        }

        vec3 pos_kerr = bl_to_cart_y_axis(state.x, state.y, state.z, a);
        pos = kerr_to_world(pos_kerr);
        float cart_r = length(pos);
        closest_r = min(closest_r, cart_r);

        if (state.x <= horizon_guard) {
            return accum;
        }
        if (cart_r > u_far_distance) {
            break;
        }

        float local_step = adaptive_step_size(state.x, rs);
        float near_horizon_scale = clamp((state.x - horizon_guard) / max(0.7 * rs, 1e-4), 0.08, 1.0);
        local_step *= near_horizon_scale;
        int sub_steps = 1;
        if (state.x < rs * 5.0) {
            sub_steps = 4;
        } else if (state.x < rs * 8.0) {
            sub_steps = 3;
        } else if (state.x < rs * 20.0) {
            sub_steps = 2;
        }
        float target_arc_step = local_step / float(sub_steps);
        bool stop_trace = false;

        for (int sub = 0; sub < 3; sub++) {
            if (sub >= sub_steps) {
                break;
            }

            vec3 prev_pos = pos;
            vec4 deriv_probe;
            float R_probe;
            float Theta_probe;
            kerr_derivatives(state, signs, Lz, Q, rs, a, deriv_probe, R_probe, Theta_probe);
            vec3 basis_r;
            vec3 basis_theta;
            vec3 basis_phi;
            bl_basis_y_axis(state.x, state.y, state.z, a, basis_r, basis_theta, basis_phi);
            vec3 cart_vel =
                deriv_probe.x * basis_r
                + deriv_probe.y * basis_theta
                + deriv_probe.z * basis_phi;
            float speed_cart = max(length(cart_vel), 1e-4);
            float h_arc = target_arc_step / speed_cart;
            float h_phi = 0.20 / max(abs(deriv_probe.z), 1e-4);
            float h_theta = 0.16 / max(abs(deriv_probe.y), 1e-4);
            float h_r = 0.28 / max(abs(deriv_probe.x), 1e-4);
            float h_limit = min(h_phi, min(h_theta, h_r));
            float h_step = min(h_arc, h_limit);
            h_step = clamp(h_step, h_arc * 0.04, h_arc);

            advance_kerr_ray(state, signs, Lz, Q, rs, a, h_step);
            pos_kerr = bl_to_cart_y_axis(state.x, state.y, state.z, a);
            pos = kerr_to_world(pos_kerr);

            vec3 seg = pos - prev_pos;
            float seg_len = length(seg);
            if (seg_len > 1e-6) {
                dir = seg / seg_len;
            }
            closest_r = min(closest_r, length(pos));

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
                    float path_frac = max(0.0, t1 - t0);
                    float volume_weight = clamp(path_frac * seg_len / max(disk_h * 0.75, 1e-4), 0.0, 1.4);
                    vec3 emit = disk_emission(hit, dir, rs);
                    accum += emit * volume_weight;
                }
            }

            float sun_t = 0.0;
            if (u_sun_intensity > 0.001
                && intersect_sphere_segment(prev_pos, pos, u_sun_position, u_sun_radius, sun_t)) {
                vec3 sun_hit = mix(prev_pos, pos, sun_t);
                accum += sun_emission(sun_hit);
                return accum;
            }

            if (length(pos) > u_far_distance) {
                stop_trace = true;
                break;
            }
            if (state.x <= horizon_guard) {
                return accum;
            }
        }

        if (stop_trace) {
            break;
        }
    }

    if (u_voxel_mode == 1) {
        vec3 bg = space_background(dir);
        float lens = 1.0 - smoothstep(rs * 2.0, rs * 10.0, closest_r);
        lens = floor(lens * 5.0 + 0.5) / 5.0;

        float ring_mix = clamp((closest_r - rs) / max(rs * 5.0, 1e-4), 0.0, 1.0);
        ring_mix = floor(ring_mix * 5.0 + 0.5) / 5.0;
        vec3 ring_tint = banded_pixel_color(1.0 - ring_mix * 0.90);

        bg *= mix(1.0, 0.35, lens);
        accum += bg;
        accum += ring_tint * lens * 0.95;
        return accum;
    }

    vec3 bg = space_background(dir);
    float lens = 1.0 - smoothstep(rs * 2.0, rs * 11.0, closest_r);
    float ring_mix = clamp((closest_r - rs) / max(rs * 5.0, 1e-4), 0.0, 1.0);
    vec3 ring_tint = mix(vec3(1.0, 0.94, 0.88), vec3(1.0, 0.35, 0.72), ring_mix);
    bg *= mix(1.0, 0.44, lens * 0.82);
    accum += bg;
    accum += ring_tint * pow(lens, 2.1) * 0.78;

    return accum;
}

void main() {
    vec2 sample_coord = gl_FragCoord.xy;
    if (u_voxel_mode == 1) {
        float pixel = pixel_screen_size();
        sample_coord = (floor(sample_coord / pixel) + 0.5) * pixel;
    }

    vec2 ndc = (sample_coord / u_resolution) * 2.0 - 1.0;
    ndc.x *= u_resolution.x / u_resolution.y;

    float tan_half_fov = tan(0.5 * u_fov_y);
    vec3 ray_dir = normalize(
        u_cam_forward
        + ndc.x * tan_half_fov * u_cam_right
        + ndc.y * tan_half_fov * u_cam_up
    );

    vec3 scene = trace_black_hole(u_cam_pos, ray_dir);
    vec3 color = vec3(1.0) - exp(-scene * u_exposure);
    color = pow(color, vec3(1.0 / 2.2));

    if (u_voxel_mode == 1) {
        color = clamp(color, 0.0, 1.0);
        color = nearest_pixel_color(color);
    } else {
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, 1.08);

        float vignette = 1.0 - smoothstep(0.32, 1.20, dot(ndc, ndc));
        color *= 0.80 + 0.20 * vignette;
        color = clamp(color, 0.0, 1.0);
    }

    fragColor = vec4(color, 1.0);
}
