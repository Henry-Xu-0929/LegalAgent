# Appendix G: Quality Assurance Plan

**Project:** WeLegal – Dual-Platform Intelligent Legal Service System
**Version:** v1.0
**Date:** October 2026
**Owner:** Documentation & QA Lead

---

## 1. Purpose

This QA Plan defines the quality standards, activities, tools, and acceptance criteria for the WeLegal project. It ensures that all deliverables meet the required level of quality before handover.

---

## 2. Quality Standards

| Area               | Standard                                    | Measurement                              |
| :----------------- | :------------------------------------------ | :--------------------------------------- |
| **Code Quality**   | ESLint + Prettier compliance                | Zero lint errors before merge            |
| **Test Coverage**  | Unit tests for critical functions           | ≥ 80% coverage for aggregation functions |
| **Documentation**  | All public APIs documented                  | JSDoc comments present                   |
| **UI Consistency** | Design system adherence                     | Component parity checklist passed        |
| **Performance**    | First-token latency                         | < 3 seconds                              |
| **Security**       | No plaintext passwords; no API keys in code | Security checklist passed                |

---

## 3. QA Activities by Sprint Phase

| Phase                    | Activity                                       | Responsible            | Output              |
| :----------------------- | :--------------------------------------------- | :--------------------- | :------------------ |
| **Sprint Planning**      | Define acceptance criteria for each user story | All                    | Sprint Backlog      |
| **Development**          | Peer code review before merge                  | All                    | PR review comments  |
| **Daily**                | Unit tests run locally                         | Developers             | Test results        |
| **Sprint Review**        | Demo working increment to client               | All                    | Feedback log        |
| **Sprint Retrospective** | Process improvement action                     | Scrum Master           | Retrospective notes |
| **Pre-Release**          | Integration testing; UAT                       | QA Lead                | Test report         |
| **Handover**             | Security audit; documentation review           | Backend Lead; Doc Lead | Handover checklist  |

---

## 4. Testing Tools

| Tool                  | Purpose                              |
| :-------------------- | :----------------------------------- |
| **Jest**              | Unit testing (JavaScript/TypeScript) |
| **Cypress**           | End-to-end testing (Web application) |
| **WeChat DevTools**   | Mini Program testing                 |
| **Postman**           | API testing                          |
| **ESLint + Prettier** | Code quality                         |
| **GitHub Actions**    | CI/CD pipeline                       |

---

## 5. QC Processes

### 5.1 Code Review

- Every Pull Request requires at least **one approval**.
- Reviewer checks: logic, edge cases, naming, comments, tests.
- No direct push to `main`.

### 5.2 Testing Workflow

1. Developer writes unit tests for new functions.
2. Developer runs local tests before pushing.
3. CI pipeline runs all tests on PR.
4. QA Lead runs integration tests before Sprint Review.

### 5.3 Bug Tracking

- Bugs logged as GitHub Issues with label `bug`.
- Priority assigned (Critical/High/Medium/Low).
- Fixed bugs verified by QA Lead before closing.

---

## 6. Acceptance Criteria

### 6.1 Functional Acceptance

- All P0 requirements (FR-1 to FR-10) implemented and tested.
- End-to-end workflow from material upload → fact extraction → element assignment → user confirmation → impact propagation verified.
- Unauthorized Update Count = 0 (automated test assertion).

### 6.2 Non-Functional Acceptance

- First-token latency < 3 seconds (measured in Sprint 8).
- Element aggregation < 100ms (unit test).
- Mobile responsive (375px–1920px).
- No security vulnerabilities in OWASP Top 10 checklist.

### 6.3 User Acceptance Testing (UAT)

- Client (Ling Lei) tests the prototype in Sprint 10.
- Feedback recorded and addressed before final handover.

---

## 7. Quality Metrics (Tracked per Sprint)

| Metric                | Target           | Sprint 1 | Sprint 2 | ...  |
| :-------------------- | :--------------- | :------- | :------- | :--- |
| Unit test coverage    | ≥ 80%            | —        | —        | —    |
| Bugs found            | —                | —        | —        | —    |
| Bugs fixed            | 100% of Critical | —        | —        | —    |
| PR review time        | < 24 hours       | —        | —        | —    |
| CI pipeline pass rate | 100%             | —        | —        | —    |

---

**Last Updated:** 2026-10-09
**Next Review:** Sprint 2 Retrospective