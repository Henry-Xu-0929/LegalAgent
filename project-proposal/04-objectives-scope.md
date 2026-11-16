## 04. Objective and Scope

### Project Objectives

**High-Level Objective:** Deliver WeLegal as a dual-platform (WeChat Mini Program + Web application) intelligent legal service system that enables SMEs to complete the full legal text lifecycle—consultation, drafting, review, structured verification, and document delivery—within a single Case-centric environment.

**Measurable Outcomes:**

| Outcome                   | Target                                                       | Measurement                        |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| Functional coverage       | 5 integrated modules across 2 platforms                      | Feature completion checklist       |
| Closed-loop verification  | End-to-end workflow from material upload → fact extraction → element assignment → user confirmation → impact propagation | Command-line/data-layer validation |
| RAG retrieval accuracy    | Report Recall@K on 20 annotated test cases                   | Evaluation script                  |
| Unauthorized Update Count | **0**                                                        | Automated test assertion           |
| Demo reliability          | 3-minute live demonstration of the Intelligent Legal Review high point | Rehearsal log                      |

### High-Level Requirements

#### Functional Requirements

| ID    | Requirement                                           | Priority | Platform |
| ----- | ----------------------------------------------------- | -------- | -------- |
| FR-1  | Case management (create/rename/archive/delete)        | P0       | Both     |
| FR-2  | Material ingestion with OCR and segment-level parsing | P0       | Both     |
| FR-3  | Fact extraction with source segment traceability      | P0       | Both     |
| FR-4  | Element assignment matching (candidate edges)         | P0       | Both     |
| FR-5  | User confirm/reject/reassign/modify fact              | P0       | Both     |
| FR-6  | Element aggregation display (3 states + annotations)  | P0       | Both     |
| FR-7  | Invalidation marking and aggregation recalculation    | P0       | Both     |
| FR-8  | Impact scope visualisation                            | P0       | Both     |
| FR-9  | Document generation with unconfirmed-item annotation  | P1       | Both     |
| FR-10 | Manual entry fallback (OCR failure path)              | P0       | Both     |
| FR-11 | Unclassifiable queue                                  | P1       | Both     |
| FR-12 | Source tracing and AI involvement labelling           | P1       | Both     |
| —     | Contract drafting (with Case fact inheritance)        | P0       | Both     |
| —     | Contract review (with risk-to-fact writeback)         | P0       | Both     |
| —     | Legal consultation (merged dialogue + analysis)       | P0       | Both     |

These functional requirements are grounded in legal human-verification research. FR-5 (user confirm/reject/reassign/modify) and FR-7 (invalidation marking) directly implement the "explicit confirmation gates" recommended by Nguyen et al. (2026), separating "AI extracted this text" from "reviewer confirmed the extraction." FR-12 (source tracing and AI involvement labelling) ensures that reviewers can validate the representational and logical correctness of AI outputs, addressing the finding that legal AI fits data-intensive research better than complex contextual judgment (Nosrati et al., 2025). The system deliberately routes uncertain or high-risk items to human review, rejecting the "click-through or unreviewed bulk acceptance" pattern that undermines legal accountability.

#### Non-Functional Requirements

| Category            | Requirement                                           | Target                                            |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| **Security**        | Password hashing (scrypt/bcrypt)                      | Replaces plaintext storage                        |
| **Security**        | Server-side authentication validation                 | Cloud function-level identity check               |
| **Security**        | Domestic OCR service                                  | Replaces `api.ocr.space` (cross-border data risk) |
| **Compliance**      | AI-generated content labelling                        | Explicit + metadata labels in exports             |
| **Performance**     | Streaming output first-token latency                  | < 3 seconds                                       |
| **Performance**     | Element aggregation computation                       | O(n) pure function, < 100ms                       |
| **Usability**       | Mobile-first responsive design                        | Web application adapts to 375px–1920px            |
| **Reliability**     | Graceful degradation on OCR failure                   | Manual entry path available                       |
| **Scalability**     | Modular expansion for new cause types                 | New ElementDef JSON, no code change               |
| **Maintainability** | Separation of Fact.history and AssignmentEdge.history | Strict dual-history discipline                    |
| **Cost-efficiency** | Serverless deployment for early-stage AI workloads    | Scale-to-zero for low traffic; pay-per-invocation |

The decision to embed WeLegal within the Enterprise WeChat ecosystem is further validated by productivity research. Two randomized trials involving **310 information workers** demonstrated that AI assistants significantly reduced task completion time by bringing retrieval, summarization, and drafting into existing workflows (Edelman et al., 2023). A separate preregistered experiment with **453 professionals** using ChatGPT on writing tasks found a **40% increase in speed** and an **18% improvement in output quality** (Noy & Zhang, 2023). However, a realistic enterprise chatbot study also observed slightly longer completion times due to higher cognitive load, confirming that speed alone is an incomplete measure (Schmidhuber et al., 2021). WeLegal addresses this by integrating into the conversation where the work already happens, reducing app-switching and search overhead while keeping legal judgment under qualified human control.

### Scope Statement

**In Scope:**

- Five integrated functional modules
- Dual-platform delivery (WeChat Mini Program + responsive Web)
- Case-centric data architecture (5 new collections)
- Intelligent Legal Review with 3-element private lending framework
- 1 inference edge, 1-layer propagation
- Serverless deployment on Tencent CloudBase
- 20-case annotated evaluation dataset

**Out of Scope:**

- Legal knowledge base / statute retrieval / case law database
- Proof strength evaluation or outcome prediction
- Multi-cause-of-action support (v1: private lending only)
- Conflict auto-detection (design documented, v1 not implemented)
- Multi-layer dependency propagation (>1 layer)
- Electronic signatures, online case filing, lawyer collaboration
- Subscription reminders, PDF export, sharing features
- Reports page (to be **deleted**—fabricated data is a negative asset)

### Stakeholders

| Stakeholder        | Role                | Interest                                |
| ------------------ | ------------------- | --------------------------------------- |
| Ling Lei (Client)  | Project sponsor     | Functional delivery; feedback           |
| Petteri Kaskenpalo | Academic supervisor | Methodology compliance; progress review |
| Team Members (4)   | Development team    | Skill development; grade                |
| SME End Users      | Target users        | Usable, affordable legal support        |
| Course Instructors | Assessors           | Rubric compliance                       |
| Peer Reviewers     | Peer feedback       | Quality benchmark                       |