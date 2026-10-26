# Keep observations separate from what the owner was actually notified about.
# Warning flaps stay in the local log; they cannot reset the daily email budget.
def routine:
  . == "load" or . == "memory" or . == "swap" or
  . == "supply-missing" or . == "supply-partial";
def critical: with_entries(select(.key | routine | not));
def warnings: with_entries(select(.key | routine));
def missing($other): with_entries(select(.key as $key | $other | has($key) | not));
def accepted: . == "smtp-accepted" or . == "webhook-accepted";
def valid_state:
  type == "object" and (.notifiedAlerts | type) == "object" and
  (.clearedSince | type) == "object" and
  ([.lastRoutineAt, .lastCriticalAt, .lastAttemptAt] | all(type == "number" and . >= 0)) and
  (.lastAttemptKey | type) == "string" and
  ([.clearedSince[]] | all(type == "number" and . >= 0));

(if ($previous.notifications | valid_state) then $previous.notifications else {
  notifiedAlerts: (if ($previous.delivery | accepted) then $previous.alerts else {} end),
  lastRoutineAt: $previous.lastDeliveredAt,
  lastCriticalAt: $previous.lastDeliveredAt,
  lastAttemptAt: 0,
  lastAttemptKey: "",
  clearedSince: {}
} end) as $prior |
($prior.notifiedAlerts // {}) as $notified |
($active | critical) as $critical |
($notified | critical | missing($active)) as $cleared |
# Do not call a long monitoring gap evidence of a continuous recovery.
($prior.observedAt != null and $now >= $prior.observedAt and $now - $prior.observedAt <= 900) as $continuous |
($cleared | with_entries(.value = (if $continuous then ($prior.clearedSince[.key] // $now) else $now end))) as $clearedSince |
($cleared | with_entries(select($now - $clearedSince[.key] >= $recoverySeconds))) as $recoveredCritical |
($critical | missing($notified)) as $openedCritical |
($active | warnings) as $routine |
($notified | warnings | missing($active)) as $recoveredRoutine |
($active | missing($notified)) as $opened |
($recoveredCritical + $recoveredRoutine) as $recovered |
($active + ($cleared | missing($recoveredCritical))) as $nextNotified |
((($openedCritical | length) + ($recoveredCritical | length) > 0) or
  (($critical | length) > 0 and $now - ($prior.lastCriticalAt // 0) >= $repeatSeconds)) as $urgent |
(((($routine | length) + ($recoveredRoutine | length)) > 0) and
  $now - ($prior.lastRoutineAt // 0) >= $repeatSeconds) as $daily |
(if $test then "test"
 elif $urgent then
   if ($active | length) > 0 then "alert"
   elif ($nextNotified | length) == 0 then "recovery"
   else "summary" end
 else "summary" end) as $kind |
{schemaVersion:1, source:"host", kind:$kind, active:($active|keys),
 opened:($opened|keys), recovered:($recovered|keys)} as $payload |
(if $urgent then {critical:($critical|keys), recovered:($recoveredCritical|keys)} | tojson else "summary" end) as $attemptKey |
($test or $urgent or $daily) as $due |
($due and ($test or $attemptKey != ($prior.lastAttemptKey // "") or
  $now - ($prior.lastAttemptAt // 0) >= $retrySeconds)) as $send |
($prior + {clearedSince:$clearedSince, observedAt:$now}) as $observed |
{
  send:$send,
  pending:$due,
  payload:$payload,
  # A test delivery never consumes an incident or the routine summary budget.
  attempted:(if $send and ($test|not) then $observed + {lastAttemptAt:$now, lastAttemptKey:$attemptKey} else $observed end),
  delivered:(if $test then $observed else $observed + {
    notifiedAlerts:$nextNotified, lastRoutineAt:$now,
    lastCriticalAt:(if $urgent or ($critical|length)>0 then $now else ($prior.lastCriticalAt // 0) end),
    lastAttemptAt:0, lastAttemptKey:""
  } end)
}
