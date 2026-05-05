import re, os

os.chdir(r"c:\Users\kapten\Desktop\radio hits")
with open("styles.css", encoding="utf-8") as fh:
    css = fh.read()

print(f"Loaded: {len(css)} chars")

# ── 1. Replace :root block ────────────────────────────────────────────────────
new_root = """:root {
  /* Black / anthracite backgrounds */
  --bg: #0a0a0a;
  --bg-elevated: #0f0f0f;
  --surface: #1a1a1a;
  --surface-glass: rgba(255, 255, 255, 0.03);
  --surface-warm: #242424;
  --vinyl: #080808;
  /* Text */
  --ink: #f5f5f5;
  --muted: #888888;
  /* Borders */
  --line: rgba(255, 255, 255, 0.08);
  --gold-border: rgba(255, 255, 255, 0.13);
  /* Red accent (primary) */
  --accent: #c8102e;
  --accent-bright: #e8192e;
  --accent-glow: rgba(220, 20, 48, 0.42);
  /* Red highlights (replaces amber role) */
  --amber: #e8192e;
  --amber-soft: #ff3349;
  --amber-glow: rgba(220, 20, 48, 0.35);
  --amber-slot: #e8192e;
  /* Night */
  --night: #060606;
  /* Shadows */
  --shadow: 0 28px 80px rgba(0, 0, 0, 0.65);
  --shadow-rest: 0 4px 24px rgba(0, 0, 0, 0.4);
  --shadow-lift: 0 18px 52px rgba(0, 0, 0, 0.55);
  --shadow-warm: 0 12px 40px rgba(220, 20, 48, 0.14);
  --shadow-glow-play: 0 12px 40px rgba(220, 20, 48, 0.52);
  /* Easing */
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-soft: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 0.15s;
  --duration-normal: 0.25s;
  --duration-slow: 0.4s;
  /* Focus ring */
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px rgba(220, 20, 48, 0.9);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --font-display: "Syne", Inter, system-ui, sans-serif;
  --font-ui: Inter, ui-sans-serif, system-ui, sans-serif;
  --grain-svg: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.35'/%3E%3C/svg%3E");
}"""

# Find :root block boundaries using brace counting
depth = 0
i = 0
root_end = 0
while i < len(css):
    if css[i] == '{':
        depth += 1
    elif css[i] == '}':
        depth -= 1
        if depth == 0:
            root_end = i + 1
            break
    i += 1

css = new_root + css[root_end:]
print(f"Step 1 done. Length: {len(css)}")

# ── 2. rgba(212, 160, 41, X) → rgba(220, 20, 48, X) ─────────────────────────
alphas = ['0.01','0.02','0.025','0.03','0.04','0.06','0.07','0.08','0.09',
          '0.10','0.12','0.15','0.18','0.20','0.22','0.28','0.30','0.32',
          '0.35','0.42','0.50','0.55','0.75','0.90',
          '0.1','0.5']
for a in alphas:
    css = css.replace(f"rgba(212, 160, 41, {a})", f"rgba(220, 20, 48, {a})")
    css = css.replace(f"rgba(212,160,41,{a})", f"rgba(220, 20, 48, {a})")
remaining = len(re.findall(r'rgba\(212,\s*160,\s*41', css))
print(f"Step 2 done (amber rgba). Remaining: {remaining}")

# ── 3. Warm cream → white (halved opacity) ────────────────────────────────────
cream_map = {
    'rgba(255, 235, 190, 0.01)': 'rgba(255, 255, 255, 0.01)',
    'rgba(255, 235, 190, 0.02)': 'rgba(255, 255, 255, 0.01)',
    'rgba(255, 235, 190, 0.03)': 'rgba(255, 255, 255, 0.02)',
    'rgba(255, 235, 190, 0.04)': 'rgba(255, 255, 255, 0.02)',
    'rgba(255, 235, 190, 0.05)': 'rgba(255, 255, 255, 0.03)',
    'rgba(255, 235, 190, 0.06)': 'rgba(255, 255, 255, 0.03)',
    'rgba(255, 235, 190, 0.08)': 'rgba(255, 255, 255, 0.04)',
    'rgba(255, 235, 190, 0.1)':  'rgba(255, 255, 255, 0.05)',
    'rgba(255, 235, 190, 0.10)': 'rgba(255, 255, 255, 0.05)',
    'rgba(255, 235, 190, 0.12)': 'rgba(255, 255, 255, 0.06)',
    'rgba(255, 235, 190, 0.15)': 'rgba(255, 255, 255, 0.08)',
    'rgba(255, 235, 190, 0.20)': 'rgba(255, 255, 255, 0.10)',
    'rgba(255, 235, 190, 0.25)': 'rgba(255, 255, 255, 0.13)',
    'rgba(255, 235, 190, 0.30)': 'rgba(255, 255, 255, 0.15)',
    'rgba(255, 220, 100, 0.05)': 'rgba(255, 255, 255, 0.05)',
    'rgba(255, 220, 100, 0.08)': 'rgba(255, 255, 255, 0.08)',
    'rgba(255, 220, 100, 0.1)':  'rgba(255, 255, 255, 0.10)',
    'rgba(255, 220, 100, 0.10)': 'rgba(255, 255, 255, 0.10)',
    'rgba(255, 220, 100, 0.15)': 'rgba(255, 255, 255, 0.15)',
    'rgba(255, 220, 100, 0.20)': 'rgba(255, 255, 255, 0.20)',
}
for old, new in cream_map.items():
    css = css.replace(old, new)
print("Step 3 done (warm cream).")

# ── 4. Warm brown hex → neutral ───────────────────────────────────────────────
hex_map = {
    '#0d0b09': '#0a0a0a',
    '#131009': '#0f0f0f',
    '#1c1610': '#1a1a1a',
    '#100c07': '#080808',
    '#100e0b': '#060606',
    '#0d0a07': '#090909',
    '#1c1408': '#1c1c1c',
    '#100b05': '#101010',
    '#1a1410': '#1a1a1a',
    '#0f0c08': '#0f0f0f',
    '#2c2010': '#2a2a2a',
    '#241c10': '#242424',
    '#221608': '#202020',
    '#2e2010': '#2a2a2a',
    '#160f08': '#141414',
    '#0c0a07': '#0a0a0a',
    '#0a0806': '#080808',
    '#2a1c0a': '#222222',
}
for old, new in hex_map.items():
    css = css.replace(old, new)
print("Step 4 done (hex backgrounds).")

# ── 5. Warm rgba backgrounds ─────────────────────────────────────────────────
warm_rgba = {
    'rgba(13, 11, 9, 0.85)':  'rgba(10, 10, 10, 0.85)',
    'rgba(13, 11, 9, 0.92)':  'rgba(10, 10, 10, 0.92)',
    'rgba(13, 11, 9, 0.95)':  'rgba(10, 10, 10, 0.95)',
    'rgba(16, 14, 11, 0.85)': 'rgba(12, 12, 12, 0.85)',
    'rgba(16, 14, 11, 0.90)': 'rgba(12, 12, 12, 0.90)',
    'rgba(16, 14, 11, 0.95)': 'rgba(12, 12, 12, 0.95)',
    'rgba(16, 14, 11, 0.97)': 'rgba(12, 12, 12, 0.97)',
    'rgba(16, 14, 11, 0.99)': 'rgba(12, 12, 12, 0.99)',
    'rgba(10, 8, 6, 0.95)':   'rgba(8, 8, 8, 0.95)',
    'rgba(12, 12, 16, 0.97)': 'rgba(10, 10, 10, 0.97)',
    'rgba(16, 13, 10, 0.98)': 'rgba(10, 10, 10, 0.98)',
}
for old, new in warm_rgba.items():
    css = css.replace(old, new)
print("Step 5 done (warm rgba backgrounds).")

# ── 6. Specific gradients ─────────────────────────────────────────────────────
# Brand mark
css = css.replace(
    "linear-gradient(145deg, var(--amber-soft) 0%, #8b6010 48%, var(--vinyl) 100%)",
    "linear-gradient(145deg, var(--accent-bright) 0%, #8a0018 48%, var(--vinyl) 100%)"
)
# Play button
css = css.replace(
    "linear-gradient(165deg, var(--amber-soft) 0%, var(--amber) 40%, #8b5e10 78%, #5c3a08 100%)",
    "linear-gradient(165deg, var(--accent-bright) 0%, var(--accent) 40%, #8a0018 78%, #4a000e 100%)"
)
# Hero warm radial
css = css.replace("rgba(110, 65, 10, 0.2)", "rgba(150, 10, 28, 0.15)")
css = css.replace("rgba(110, 65, 10, 0.15)", "rgba(150, 10, 28, 0.10)")
# Vinyl disc conic-gradient
css = css.replace(
    "conic-gradient(from 0deg, #1c1408, #2a1c0a, #1c1408, #221608, #1c1408, #2e2010, #1c1408)",
    "conic-gradient(from 0deg, #1a1a1a, #222222, #1a1a1a, #1e1e1e, #1a1a1a, #2a2a2a, #1a1a1a)"
)
print("Step 6 done (gradients).")

# ── 7. Old accent red hex values ─────────────────────────────────────────────
css = css.replace("rgba(200, 50, 30, 0.42)", "rgba(220, 20, 48, 0.42)")
css = css.replace("rgba(200, 50, 30, 0.35)", "rgba(220, 20, 48, 0.35)")
css = css.replace("rgba(200, 50, 30, 0.52)", "rgba(220, 20, 48, 0.52)")
css = css.replace("#b5232e", "#c8102e")
css = css.replace("#d4342a", "#e8192e")
print("Step 7 done (old accent reds).")

# ── Write ─────────────────────────────────────────────────────────────────────
with open("styles.css", "w", encoding="utf-8") as fh:
    fh.write(css)

print(f"\nDONE. Written {len(css)} chars.")
print(f"Remaining rgba(212): {len(re.findall(r'rgba\\(212,\\s*160,\\s*41', css))}")
print(f"Remaining #d4a029/#e8b84b: {len(re.findall(r'#d4a029|#e8b84b', css))}")
print(f"Remaining warm brown (#1c1408 etc): {len(re.findall(r'#1c1408|#0d0b09|#131009', css))}")
