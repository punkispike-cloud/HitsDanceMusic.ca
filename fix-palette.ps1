Set-Location "c:\Users\kapten\Desktop\radio hits"
$f = "styles.css"
$css = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
Write-Host "Loaded: $($css.Length) chars"

# ── Step 1: Replace root block by position ──────────────────────────────────
$depth = 0; $p = 0
while ($p -lt $css.Length) {
    if ($css[$p] -eq '{') { $depth++ }
    elseif ($css[$p] -eq '}') { $depth--; if ($depth -eq 0) { break } }
    $p++
}
$rootEnd = $p + 1

$newRoot = @":root {
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
  /* Focus - red ring */
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
}"@

$css = $newRoot + $css.Substring($rootEnd)
Write-Host "Step 1 done. Length: $($css.Length)"

# ── Step 2: rgba(212, 160, 41, X) → rgba(220, 20, 48, X) ────────────────────
$alphas = @('0.01','0.02','0.025','0.03','0.04','0.06','0.07','0.08','0.09','0.10','0.12','0.15','0.18','0.20','0.22','0.28','0.30','0.32','0.35','0.42','0.50','0.55','0.75','0.90')
foreach ($a in $alphas) {
    $css = $css.Replace("rgba(212, 160, 41, $a)", "rgba(220, 20, 48, $a)")
    $css = $css.Replace("rgba(212,160,41,$a)", "rgba(220, 20, 48, $a)")
}
# also handle 0.1 etc without leading zero
$css = $css.Replace("rgba(212, 160, 41, .1)", "rgba(220, 20, 48, 0.10)")
Write-Host "Step 2 done (amber rgba). Remaining amber rgba: $(([regex]::Matches($css,'rgba\(212,\s*160,\s*41')).Count)"

# ── Step 3: warm cream highlights → white ────────────────────────────────────
$css = $css.Replace("rgba(255, 235, 190, 0.01)", "rgba(255, 255, 255, 0.01)")
$css = $css.Replace("rgba(255, 235, 190, 0.02)", "rgba(255, 255, 255, 0.01)")
$css = $css.Replace("rgba(255, 235, 190, 0.03)", "rgba(255, 255, 255, 0.02)")
$css = $css.Replace("rgba(255, 235, 190, 0.04)", "rgba(255, 255, 255, 0.02)")
$css = $css.Replace("rgba(255, 235, 190, 0.05)", "rgba(255, 255, 255, 0.03)")
$css = $css.Replace("rgba(255, 235, 190, 0.06)", "rgba(255, 255, 255, 0.03)")
$css = $css.Replace("rgba(255, 235, 190, 0.08)", "rgba(255, 255, 255, 0.04)")
$css = $css.Replace("rgba(255, 235, 190, 0.10)", "rgba(255, 255, 255, 0.05)")
$css = $css.Replace("rgba(255, 235, 190, 0.1)", "rgba(255, 255, 255, 0.05)")
$css = $css.Replace("rgba(255, 235, 190, 0.12)", "rgba(255, 255, 255, 0.06)")
$css = $css.Replace("rgba(255, 235, 190, 0.15)", "rgba(255, 255, 255, 0.08)")
$css = $css.Replace("rgba(255, 235, 190, 0.20)", "rgba(255, 255, 255, 0.10)")
$css = $css.Replace("rgba(255, 235, 190, 0.25)", "rgba(255, 255, 255, 0.13)")
$css = $css.Replace("rgba(255, 235, 190, 0.30)", "rgba(255, 255, 255, 0.15)")
$css = $css.Replace("rgba(255, 220, 100, 0.05)", "rgba(255, 255, 255, 0.05)")
$css = $css.Replace("rgba(255, 220, 100, 0.08)", "rgba(255, 255, 255, 0.08)")
$css = $css.Replace("rgba(255, 220, 100, 0.10)", "rgba(255, 255, 255, 0.10)")
$css = $css.Replace("rgba(255, 220, 100, 0.1)", "rgba(255, 255, 255, 0.10)")
$css = $css.Replace("rgba(255, 220, 100, 0.15)", "rgba(255, 255, 255, 0.15)")
$css = $css.Replace("rgba(255, 220, 100, 0.20)", "rgba(255, 255, 255, 0.20)")
Write-Host "Step 3 done (warm cream)."

# ── Step 4: warm brown hex backgrounds → neutral ─────────────────────────────
$hexMap = @{
    '#0d0b09' = '#0a0a0a'
    '#131009' = '#0f0f0f'
    '#1c1610' = '#1a1a1a'
    '#100c07' = '#080808'
    '#100e0b' = '#060606'
    '#0d0a07' = '#090909'
    '#1c1408' = '#1c1c1c'
    '#100b05' = '#101010'
    '#1a1410' = '#1a1a1a'
    '#0f0c08' = '#0f0f0f'
    '#2c2010' = '#2a2a2a'
    '#241c10' = '#242424'
    '#221608' = '#202020'
    '#2e2010' = '#2a2a2a'
    '#160f08' = '#141414'
    '#0c0a07' = '#0a0a0a'
    '#0a0806' = '#080808'
}
foreach ($k in $hexMap.Keys) {
    $css = $css.Replace($k, $hexMap[$k])
}
Write-Host "Step 4 done (hex backgrounds)."

# ── Step 5: warm rgba backgrounds ────────────────────────────────────────────
$css = $css.Replace("rgba(13, 11, 9, 0.85)", "rgba(10, 10, 10, 0.85)")
$css = $css.Replace("rgba(16, 14, 11, 0.97)", "rgba(12, 12, 12, 0.97)")
$css = $css.Replace("rgba(16, 14, 11, 0.99)", "rgba(12, 12, 12, 0.99)")
$css = $css.Replace("rgba(10, 8, 6, 0.95)", "rgba(8, 8, 8, 0.95)")
$css = $css.Replace("rgba(12, 12, 16, 0.97)", "rgba(10, 10, 10, 0.97)")
$css = $css.Replace("rgba(16, 13, 10, 0.98)", "rgba(10, 10, 10, 0.98)")
$css = $css.Replace("rgba(13, 11, 9, 0.92)", "rgba(10, 10, 10, 0.92)")
$css = $css.Replace("rgba(13, 11, 9, 0.95)", "rgba(10, 10, 10, 0.95)")
$css = $css.Replace("rgba(16, 14, 11, 0.95)", "rgba(12, 12, 12, 0.95)")
$css = $css.Replace("rgba(16, 14, 11, 0.90)", "rgba(12, 12, 12, 0.90)")
$css = $css.Replace("rgba(16, 14, 11, 0.85)", "rgba(12, 12, 12, 0.85)")
Write-Host "Step 5 done (warm rgba backgrounds)."

# ── Step 6: specific gradients ───────────────────────────────────────────────
# Brand mark gradient
$css = $css.Replace(
    "linear-gradient(145deg, var(--amber-soft) 0%, #8b6010 48%, var(--vinyl) 100%)",
    "linear-gradient(145deg, var(--accent-bright) 0%, #8a0018 48%, var(--vinyl) 100%)"
)
# Play button gradient
$css = $css.Replace(
    "linear-gradient(165deg, var(--amber-soft) 0%, var(--amber) 40%, #8b5e10 78%, #5c3a08 100%)",
    "linear-gradient(165deg, var(--accent-bright) 0%, var(--accent) 40%, #8a0018 78%, #4a000e 100%)"
)
# Hero warm radial
$css = $css.Replace("rgba(110, 65, 10, 0.2)", "rgba(150, 10, 28, 0.15)")
$css = $css.Replace("rgba(110, 65, 10, 0.15)", "rgba(150, 10, 28, 0.10)")

# Vinyl disc conic-gradient
$css = $css.Replace(
    "conic-gradient(from 0deg, #1c1408, #2a1c0a, #1c1408, #221608, #1c1408, #2e2010, #1c1408)",
    "conic-gradient(from 0deg, #1a1a1a, #222222, #1a1a1a, #1e1e1e, #1a1a1a, #2a2a2a, #1a1a1a)"
)
Write-Host "Step 6 done (gradients)."

# ── Step 7: Accent red rgba variants (old red #b5232e / #d4342a → new #c8102e) ─
$css = $css.Replace("rgba(200, 50, 30, 0.42)", "rgba(220, 20, 48, 0.42)")
$css = $css.Replace("rgba(200, 50, 30, 0.35)", "rgba(220, 20, 48, 0.35)")
$css = $css.Replace("rgba(200, 50, 30, 0.52)", "rgba(220, 20, 48, 0.52)")
$css = $css.Replace("#b5232e", "#c8102e")
$css = $css.Replace("#d4342a", "#e8192e")
Write-Host "Step 7 done (old accent red)."

# ── Write ─────────────────────────────────────────────────────────────────────
[IO.File]::WriteAllText($f, $css, [Text.Encoding]::UTF8)
Write-Host "DONE. Written $($css.Length) chars to $f"
Write-Host "Remaining amber rgba: $(([regex]::Matches($css,'rgba\(212,\s*160,\s*41')).Count)"
Write-Host "Remaining amber hex: $(([regex]::Matches($css,'#d4a029|#e8b84b')).Count)"
