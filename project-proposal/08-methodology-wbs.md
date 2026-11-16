## 08. Methodology and WBS

### Methodology Selection: Agile/Scrum

**Why Agile/Scrum:**

| Reason                          | Justification                                                |
| ------------------------------- | ------------------------------------------------------------ |
| **Incremental delivery**        | Five functions can be developed and validated iteratively; no risk of end-of-semester integration failure |
| **Dual-platform parallelism**   | Backend API contracts stabilise early; Mini Program and Web frontends develop in parallel against the same interface |
| **Regular supervisor feedback** | Weekly reviews with supervisor align with sprint cadence     |
| **Risk mitigation**             | High-risk components (Intelligent Review state machine) validated in early sprints |

**Methodology Consistency Declaration:** This project follows Agile/Scrum **genuinely**, not ceremonially. Research on student capstones warns against "Scrum theater"—performing ceremonies without delivering working software (Bello et al., 2025). To avoid this, WeLegal adopts the following evidence-based practices:

- **Right-sized scope and MVP:** The initial scope is deliberately constrained to a 3-element private lending framework, avoiding scope creep and aligning with academic calendar capacity (Behutiye et al., 2024).
- **Definition of Done (DoD):** Every increment must include integration, basic automated tests, and documentation to ensure apparent progress reflects working software, not just completed tickets (Dong, 2023).
- **Real stakeholder feedback:** Bi-weekly client meetings (Section 7) provide a concrete feedback path, allowing the team to adapt plans based on real-world priorities (Dong, 2023).
- **Continuous process improvement:** Each sprint retrospective must produce one concrete process change, ensuring the team learns and adapts (Bello et al., 2025).

The WBS below aligns with sprint planning—no waterfall phases masquerading as sprints.

**Technical Architecture Rationale:** The choice of a Serverless backend (Tencent CloudBase) is grounded in workload-economics literature. Fernando and Wijayanayake (2025) demonstrate that Serverless usually wins when an AI startup has low, spiky, or uncertain demand. For WeLegal's early-stage MVP phase, traffic is expected to be intermittent during development and evaluation. However, Juan and Wong (2023) caution that GPU cold starts and model-loading delays can erode serverless savings for latency-sensitive large models. Therefore, the architecture is designed with a **hybrid evolution path**: the baseline MVP operates on Serverless to minimise operations burden and avoid idle capacity costs, while the design retains the flexibility to migrate to managed containers (or a hybrid baseline-plus-burst model) if sustained GPU-heavy inference becomes necessary (Cheng et al., 2023).

### Work Breakdown Structure (WBS)

```text
WeLegal Project
│
├── 1. Project Management
│   ├── 1.1 Proposal writing and submission
│   ├── 1.2 Sprint planning and retrospectives
│   ├── 1.3 Supervisor and client meetings
│   └── 1.4 Risk and issue tracking
│
├── 2. Requirements and Design
│   ├── 2.1 PRD finalisation (v1.1 DESIGN FREEZE)
│   ├── 2.2 Dual-platform technical architecture design
│   ├── 2.3 Data model design (5 collections)
│   ├── 2.4 API contract specification
│   └── 2.5 UI/UX wireframes (P1–P6)
│
├── 3. Backend Development
│   ├── 3.1 Case management cloud functions
│   ├── 3.2 Material ingestion + OCR pipeline
│   ├── 3.3 Fact extraction service
│   ├── 3.4 Element matching engine
│   ├── 3.5 AssignmentEdge CRUD + user confirmation
│   ├── 3.6 Aggregation and invalidation propagation
│   ├── 3.7 Document generation service
│   └── 3.8 Authentication and security hardening
│
├── 4. Mini Program Development
│   ├── 4.1 Feature consolidation (6→5 windows)
│   ├── 4.2 Case list and workspace pages
│   ├── 4.3 Element verification table
│   ├── 4.4 Material source tracing and highlighting
│   ├── 4.5 Impact scope display
│   └── 4.6 Document library (foodBuy → documents)
│
├── 5. Web Application Development
│   ├── 5.1 Shared component library setup
│   ├── 5.2 Case management and workspace
│   ├── 5.3 Element verification interface
│   ├── 5.4 Material viewer with segment highlighting
│   ├── 5.5 Streaming chat interface
│   └── 5.6 Responsive layout and cross-browser testing
│
├── 6. AI / RAG Engineering
│   ├── 6.1 Prompt engineering (18 constraints + 3 new)
│   ├── 6.2 Retrieval engine adaptation (query→element)
│   ├── 6.3 Fact extraction pipeline
│   ├── 6.4 Element matching with 12-path scoring
│   └── 6.5 Evaluation dataset (20 cases)
│
├── 7. Testing and QA
│   ├── 7.1 Unit tests (aggregation functions)
│   ├── 7.2 Integration tests (end-to-end workflow)
│   ├── 7.3 Dual-platform consistency testing
│   ├── 7.4 Unauthorized Update Count assertion
│   └── 7.5 User acceptance testing (client feedback)
│
├── 8. Documentation and Deliverables
│   ├── 8.1 Project proposal (this document)
│   ├── 8.2 PRD maintenance
│   ├── 8.3 User manual
│   ├── 8.4 Technical documentation
│   └── 8.5 Final report and reflection
│
└── 9. Handover
    ├── 9.1 Client training session
    ├── 9.2 Deployment documentation
    ├── 9.3 Source code repository handover
    └── 9.4 Maintenance guide
```

### Sprint Plan (Two Semesters)

| Sprint | Weeks | Focus                                                 | Deliverable                           |
| ------ | ----- | ----------------------------------------------------- | ------------------------------------- |
| S1     | 1–2   | Upskilling; architecture design; API contracts        | Architecture document; API spec       |
| S2     | 3–4   | M0: Demo JSON validation; Case CRUD                   | Static JSON workflow validated        |
| S3     | 5–6   | M1: Data layer (5 collections); aggregation functions | Command-line closed loop              |
| S4     | 7–8   | M1: User confirmation; invalidation propagation       | End-to-end data-layer workflow        |
| S5     | 9–10  | M2: Mini Program interaction layer (P1–P5)            | Mini Program demo                     |
| S6     | 11–12 | M2: Web application interaction layer                 | Web demo; **Week 12 Mid-term Review** |
| S7     | 13–14 | M3: Document generation; unclassifiable queue         | Document output validated             |
| S8     | 15–16 | M4: Evaluation (20 cases, 6 metrics)                  | Evaluation report                     |
| S9     | 17–18 | M5: Security hardening; domestic OCR                  | Security checklist                    |
| S10    | 19–20 | M6: Polishing; demo rehearsal; final deliverables     | Final presentation; handover          |

Crucially, the Agile/Scrum methodology supports the human-in-the-loop design by scheduling regular reviews of prototype outputs with the client. The **evaluation dataset (20 cases)** and the **unauthorized update count assertion (0)** in the WBS serve as empirical validation mechanisms. As highlighted by Karakurt and Akbulut (2025), fewer than 15% of enterprise RAG/LLM studies address real-time integration challenges, often leaving a gap between prototype evaluation and production deployment. WeLegal mitigates this by building the evaluation scripts and verification gates directly into the sprint deliverables, rather than treating them as afterthoughts.