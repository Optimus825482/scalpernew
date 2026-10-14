Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$outDir = "D:\scalpernew\frontend\public\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Draw-Artwork([System.Drawing.Graphics]$g, [float]$size, [bool]$maskable) {
  # 512-design space -> target space. Maskable: artwork scaled 0.66 about center.
  $k = $size / 512.0
  $c = $size / 2.0
  $s = 1.0
  if ($maskable) { $s = 0.66 }
  function X([float]$v) { return $c + ($v - 256.0) * $k * $s }
  function Y([float]$v) { return $c + ($v - 256.0) * $k * $s }
  $lw = 34.0 * $k * $s

  # --- faint candlesticks (behind) ---
  $candleAlpha = 26
  $candles = @(
    @(150, 322, 26, 92),   # x,y,w,h (512-space)
    @(206, 298, 26, 84),
    @(262, 246, 26, 104)
  )
  foreach ($cd in $candles) {
    $cx = X ($cd[0] + $cd[2] / 2.0)
    $cw = $cd[2] * $k * $s
    $top = Y ($cd[1] - 24)
    $bot = Y ($cd[1] + $cd[3] + 24)
    $wickPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb($candleAlpha, 255, 255, 255), (3.0 * $k * $s))
    $g.DrawLine($wickPen, $cx, $top, $cx, $bot)
    $rect = New-Object System.Drawing.Rectangle(([int]($cx - $cw / 2)), [int](Y $cd[1]), [int][Math]::Max(1, $cw), [int][Math]::Max(1, ($cd[3] * $k * $s)))
    $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($candleAlpha, 255, 255, 255))
    $g.FillRectangle($fillBrush, $rect)
    $wickPen.Dispose(); $fillBrush.Dispose()
  }

  # --- rising zigzag line with glow ---
  $pts = @(
    (New-Object System.Drawing.PointF((X 108), (Y 356))),
    (New-Object System.Drawing.PointF((X 196), (Y 258))),
    (New-Object System.Drawing.PointF((X 246), (Y 306))),
    (New-Object System.Drawing.PointF((X 392), (Y 148)))
  )
  $glowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 0x3D, 0x7B, 0xFF), (64.0 * $k * $s))
  $glowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawLines($glowPen, $pts)
  $glowPen.Dispose()

  $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0x00, 0x66, 0xFF), $lw)
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $g.DrawLines($linePen, $pts)
  $linePen.Dispose()

  # --- white arrowhead at the line end (pointing up-right) ---
  $dx = 146.0; $dy = -158.0
  $len = [Math]::Sqrt($dx * $dx + $dy * $dy)
  $ux = $dx / $len; $uy = $dy / $len
  $px = -$uy; $py = $ux
  $Dx = X 392; $Dy = Y 148
  $half = 26.0 * $k * $s
  $back = 4.0 * $k * $s
  $tipX = $Dx + $ux * (30.0 * $k * $s); $tipY = $Dy + $uy * (30.0 * $k * $s)
  $b1x = $Dx - $ux * $back + $px * $half; $b1y = $Dy - $uy * $back + $py * $half
  $b2x = $Dx - $ux * $back - $px * $half; $b2y = $Dy - $uy * $back - $py * $half
  $arrow = @(
    (New-Object System.Drawing.PointF($tipX, $tipY)),
    (New-Object System.Drawing.PointF($b1x, $b1y)),
    (New-Object System.Drawing.PointF($b2x, $b2y))
  )
  $arrowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPolygon($arrowBrush, $arrow)
  $arrowBrush.Dispose()

  # --- lightning bolt badge (top-left) — speed/scalp mark ---
  $bolt = @(
    (New-Object System.Drawing.PointF((X 152), (Y 86))),
    (New-Object System.Drawing.PointF((X 104), (Y 170))),
    (New-Object System.Drawing.PointF((X 136), (Y 170))),
    (New-Object System.Drawing.PointF((X 116), (Y 240))),
    (New-Object System.Drawing.PointF((X 178), (Y 142))),
    (New-Object System.Drawing.PointF((X 144), (Y 142)))
  )
  $boltBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 255, 255, 255))
  $g.FillPolygon($boltBrush, $bolt)
  $boltBrush.Dispose()
}

function New-Icon([int]$size, [bool]$maskable, [string]$outPath) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  if ($maskable) {
    # Full-bleed background edge-to-edge.
    $bgRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($bgRect, [System.Drawing.Color]::FromArgb(255, 0x0A, 0x11, 0x28), [System.Drawing.Color]::FromArgb(255, 0x12, 0x26, 0x5C), 45.0)
    $g.FillRectangle($bgBrush, $bgRect)
    $bgBrush.Dispose()
  } else {
    # Transparent canvas + rounded tile with small margin.
    $m = 16 * ($size / 512.0)
    $r = 116 * ($size / 512.0)
    $tileRect = New-Object System.Drawing.Rectangle([int]$m, [int]$m, [int]($size - 2 * $m), [int]($size - 2 * $m))
    $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($tileRect, [System.Drawing.Color]::FromArgb(255, 0x0A, 0x11, 0x28), [System.Drawing.Color]::FromArgb(255, 0x12, 0x26, 0x5C), 45.0)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($tileRect.X, $tileRect.Y, $d, $d, 180, 90)
    $path.AddArc($tileRect.Right - $d, $tileRect.Y, $d, $d, 270, 90)
    $path.AddArc($tileRect.Right - $d, $tileRect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($tileRect.X, $tileRect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($tileBrush, $path)
    $tileBrush.Dispose(); $path.Dispose()
  }

  Draw-Artwork $g $size $maskable
  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "written: $outPath"
}

function Resize-Icon([string]$srcPath, [int]$size, [string]$outPath) {
  $src = [System.Drawing.Image]::FromFile($srcPath)
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose(); $src.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "written: $outPath"
}

New-Icon 512 $false "$outDir\icon-512.png"
New-Icon 512 $true  "$outDir\icon-512-maskable.png"
Resize-Icon "$outDir\icon-512.png" 192 "$outDir\icon-192.png"
Resize-Icon "$outDir\icon-512-maskable.png" 192 "$outDir\icon-192-maskable.png"
Write-Host "DONE"
