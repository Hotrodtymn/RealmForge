$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $scriptDirectory 'realmforge.cjs'
$projectRoot = if ($env:REALMFORGE_PROJECT_ROOT) { $env:REALMFORGE_PROJECT_ROOT } else { (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { [System.Windows.Forms.MessageBox]::Show('Node.js was not found on PATH.','RealmForge'); exit 1 }

[System.Windows.Forms.Application]::EnableVisualStyles()

function Invoke-Launcher([string]$command) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $node
  $psi.Arguments = ('"{0}" {1} "{2}"' -f $launcher, $command, $projectRoot)
  $psi.WorkingDirectory = $projectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw (($stderr + $stdout).Trim()) }
  return $stdout.Trim()
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'RealmForge'
$form.Size = New-Object System.Drawing.Size(520,320)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(20,20)
$status.Size = New-Object System.Drawing.Size(460,60)
$status.Text = 'Checking RealmForge status...'
$status.AutoSize = $false
$form.Controls.Add($status)
$output = New-Object System.Windows.Forms.TextBox
$output.Location = New-Object System.Drawing.Point(20,90)
$output.Size = New-Object System.Drawing.Size(460,120)
$output.Multiline = $true
$output.ReadOnly = $true
$output.ScrollBars = 'Vertical'
$form.Controls.Add($output)

function Refresh-Status {
  try { $text = Invoke-Launcher 'status'; $status.Text = $text.Split([Environment]::NewLine)[0]; $output.Text = $text }
  catch { $status.Text = 'Launcher error'; $output.Text = $_.Exception.Message }
}
function Add-Button([string]$caption, [int]$left, [string]$command) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $caption; $button.Location = New-Object System.Drawing.Point($left,225); $button.Size = New-Object System.Drawing.Size(105,32)
  $button.Tag = $command
  $button.Add_Click({ param($sender, $eventArgs) try { $output.Text = Invoke-Launcher ([string]$sender.Tag); Refresh-Status } catch { $output.Text = $_.Exception.Message; $status.Text = 'Launcher error' } })
  $form.Controls.Add($button)
}
Add-Button 'Start' 20 'start'
Add-Button 'Stop' 135 'stop'
Add-Button 'Status' 250 'status'
Add-Button 'Diagnose' 365 'diagnose'
Refresh-Status
[void]$form.ShowDialog()
