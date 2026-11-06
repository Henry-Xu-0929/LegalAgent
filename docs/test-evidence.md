# Test Evidence for REQ-201 (Version 3.0)

**Objective:** Verify the archive reliability and failure visibility.

### Test Cases
- **T-A1 (Success)**: Normal archive works. 
  - *Action:* User clicks archive with internet connected.
  - *Expected:* Document saved to Cloud JSON DB, success message shown.
  - *Result:* Pass.

- **T-A2 (Fallback)**: Cloud function fails, local fallback succeeds.
  - *Action:* Simulate cloud function failure (e.g., disconnected from cloud env).
  - *Expected:* Document saved to local storage, toast shows "Saved locally".
  - *Result:* Pass.

- **T-A3 (Failure visible)**: Both paths fail.
  - *Action:* Disable both cloud and local write permissions.
  - *Expected:* UI explicitly displays failure toast, no silent loss.
  - *Result:* Pass (Fulfills REQ-201).

*Tested by: Hancheng Xu*
