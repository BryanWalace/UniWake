@{
  # IMP-018: every rule at Error/Warning severity, with the exceptions below.
  Severity     = @('ParseError', 'Error', 'Warning')
  ExcludeRules = @(
    # The prepare script talks to the technician through the console on purpose (pt-BR summary).
    'PSAvoidUsingWriteHost'
  )
}
