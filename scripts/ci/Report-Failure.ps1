# Dot-sourced by the CI scripts. Job logs and artifacts need a token to read, but annotations are
# public: a failure reports its message and the tail of every relevant log as annotations, and
# copies the logs into the workspace for the artifact upload.

function Save-CiLog([string[]]$Directory) {
  $dest = Join-Path $env:GITHUB_WORKSPACE 'build\ci-logs'
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($dir in $Directory) {
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dest ($_.FullName -replace '[:\\/]', '_')) -ErrorAction SilentlyContinue
      $tail = (Get-Content -LiteralPath $_.FullName -Tail 25 -ErrorAction SilentlyContinue) -join ' | '
      if ($tail) {
        $text = $tail.Substring([Math]::Max(0, $tail.Length - 3000))
        Write-Host "::warning title=$($_.Name)::$text"
      }
    }
  }
}

function Write-CiError([System.Management.Automation.ErrorRecord]$ErrorRecord) {
  $msg = ($ErrorRecord.Exception.Message -replace "`r?`n", ' | ')
  $where = $ErrorRecord.InvocationInfo.PositionMessage -replace "`r?`n", ' '
  Write-Host "::error title=CI script failed::$msg ($where)"
}
