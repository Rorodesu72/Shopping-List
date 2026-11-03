# Generates the home screen icons. Keep this file ASCII: PowerShell 5.1 misreads UTF-8 without a BOM.
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-Icon([int]$size, [string]$name, [double]$scale) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(27, 42, 88))

  $u = $size * $scale / 100.0
  $o = ($size - 100 * $u) / 2.0
  function P([double]$x, [double]$y) { New-Object System.Drawing.PointF ([float]($o + $x * $u)), ([float]($o + $y * $u)) }

  $tag = [System.Drawing.PointF[]]@((P 50 10), (P 80 34), (P 80 90), (P 20 90), (P 20 34))
  $g.FillPolygon((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 214, 10))), $tag)

  $hole = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(27, 42, 88))
  $g.FillEllipse($hole, [float]($o + 44 * $u), [float]($o + 25 * $u), [float](12 * $u), [float](12 * $u))

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(27, 42, 88)), ([float](9 * $u))
  $pen.StartCap = 'Round'
  $pen.EndCap = 'Round'
  $pen.LineJoin = 'Round'
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((P 35 62), (P 46 73), (P 66 50)))

  $bitmap.Save((Join-Path $outDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bitmap.Dispose()
}

New-Icon 180 'apple-touch-icon.png' 0.82
New-Icon 192 'icon-192.png' 0.82
New-Icon 512 'icon-512.png' 0.82
New-Icon 512 'icon-maskable-512.png' 0.62
