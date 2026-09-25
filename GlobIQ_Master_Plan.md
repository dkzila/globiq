# Next-Gen Global GK & Current Affairs Platform
## Master Product, Domain, Architecture, SEO & Execution Specification

**Version 2.0 — Final, Consolidated, AI-Agent-Ready**
**Format:** Markdown (designed to live in a GitHub repository and be read directly by AI coding agents)

**Purpose:** A unified global platform that replaces fragmented GK books, magazines, generic current-affairs feeds and exam-specific repetition with one structured, multilingual, personalised knowledge system — for both general knowledge-seekers and exam aspirants, accessible first as a website and later as native apps built on the same APIs.

**Execution rule:** One chat/session = one unit of work. An AI/development agent must execute only the requested session, exactly as scoped in Section 41–43. It must not begin the next session until the user explicitly requests it, and must not silently expand scope.

---

## Table of Contents

0. Executive Decision
1. Product Vision
2. Competitive Positioning
3. Non-Goals
4. Platform Surfaces: Web First, App Ready
5. Core Mental Model
6. Canonical Domain Model
7. Knowledge Unit vs Content Item
8. Exam Mapping and the Depth Problem
9. Personalisation System
10. Follow and Save
11. Multi-Exam Combination Engine
12. Current Affairs Architecture
13. Taxonomy
14. Global + Country Architecture
15. Geo and Country Access
16. URL and SEO Architecture
17. Search Strategy
18. Editorial / Content Operations
19. Editorial Workflow
20. Writer Login and Access
21. Sharing System
22. Learning & Exam Experience
23. Content Formats
24. Source and Trust Model
25. Content Feedback & Quality Loop
26. AI Layer
27. Notifications
28. Recommended Technical Boundary
29. Infrastructure Evolution
30. Security
31. Privacy and User Data
32. Analytics
33. SEO Content Strategy
34. Homepage Strategy
35. Internationalisation
36. Content Lifecycle and Versioning
37. API Principles
38. Admin vs Editorial vs Public
39. Mobile App Readiness
40. Phase Plan
41. Session Execution Protocol
42. Session Template
43. Detailed Session Roadmap
44. Acceptance Criteria for the Whole Platform
45. Seed Data Strategy
46. Critical Design Decisions That Must Not Be Reversed Casually
47. What "World Class" Means for This Product
48. Final AI Instruction
- Appendix A — Example Combined Exam
- Appendix B — Example URL Matrix
- Appendix C — Immediate Build Order
- Appendix D — Competitor Gap Analysis

---

## 0. Executive Decision

The platform must **not** be built as a collection of separate exam websites, separate country apps, or a digital magazine. It is **one global knowledge system** with a shared canonical content graph. Country, language, exam, topic, syllabus, difficulty, relevance, freshness and user state are **dimensions applied to the same underlying knowledge**, never separate copies of it.

- General users discover broad GK/current affairs through search, browse, topics and feeds — exactly like today's GK sites, but built on the same canonical data as the exam layer.
- Exam users get an **exam-aware personalised learning layer** without duplicating the underlying content.
- Multiple exams are combined by **unioning their syllabus requirements** and deduplicating canonical knowledge units — this is the single hardest and most important mechanism in the whole platform (see Section 11 and Appendix A).
- Exam depth is represented as **requirements/coverage metadata**, not by copying the same article into every exam.
- Users can **follow** exams, topics, subjects, entities and current-affairs themes, and **save** any supported content/object into personal collections. Follow and Save are deliberately separate concepts (Section 10).
- Every content item is linked to canonical topics/entities and can carry exam mappings with evidence and coverage metadata.
- India is the default/root market; English is India's default language. Neither "India"/"IN" nor "en" appears in default India URLs. Other countries live under `/country/` directories, with additional languages under `/country/language/`.
- Country isolation is a **content and data-scoping rule**, enforced server-side — not a blanket access ban, and not merely an SEO convention (Section 15 finalises this).
- SEO and Sharing are first-class, designed in from day one, not retrofitted.
- The product is **web-first**, but every feature is designed API-first so that native iOS/Android apps can be built later on the same backend without redesigning the domain model (Section 4, Section 39).
- Start as a well-bounded **modular monolith**. Do not prematurely force microservices, Kubernetes, or a vector database. Introduce specialised infrastructure only when measured load justifies it (Section 29).

---

## 1. Product Vision

The core problem is **not** a lack of GK information — the internet is saturated with it. The problem is **information fragmentation, duplication and lack of relevance**. Existing GK/current-affairs products publish large volumes of generic material and leave the learner to manually figure out what matters for their exam, their depth level and their revision stage. A student preparing for two exams at once is forced to read the same current-affairs item twice, in two different apps, with no way to know which parts actually matter for either exam.

The platform solves this by separating **KNOWLEDGE** from **CONTEXT**:
- **Knowledge** is stored once, in canonical form (a `KnowledgeUnit`).
- **Context** determines how that knowledge is presented — for a given country, language, exam, syllabus depth, user goal, difficulty level and moment in time.

The product should feel like a **personal GK operating system** — not a magazine, not a static question bank, and not a generic news feed. A user should never need to buy a GK book, a current-affairs magazine, or join a GK-only coaching class once this platform covers their needs.

### Why generic GK platforms still get traffic (and why that is not a contradiction)

It is a fair observation that today's GK/current-affairs sites (GKToday, Drishti IAS, NextIAS, gk-hindi, ExamPur, etc.) have **no personalisation and no exam-specific depth**, yet they carry heavy traffic. This is not evidence that personalisation is unnecessary — it reflects three separate realities that this platform must address together, not in isolation:

1. **Discovery and utility are different needs.** Most visits originate from a Google search for a specific fact or a specific day's current affairs ("today current affairs quiz"). The user wants an instant answer, not a curated study plan, in that moment. This is a **discovery** need, satisfied by strong SEO and broad evergreen content (Section 33).
2. **Anxiety-driven completeness reading.** Aspirants fear missing something, so they read generic feeds "just in case," even though a large fraction is irrelevant to their actual exam. This is real demand, but it is *inefficient* demand — exactly the inefficiency this platform is designed to remove once a user commits to following an exam.
3. **No real alternative exists yet.** No current platform combines broad SEO-friendly discovery with exam-mapped personalisation and multi-exam deduplication. That gap is the product opportunity.

**Conclusion for architecture:** the platform must **not** choose between "broad generic content for traffic" and "personalised exam-mapped content for utility." It must do both from the same canonical knowledge graph — broad content drives acquisition (SEO, anonymous users), and the same Knowledge Units, once a user follows an exam, are automatically re-rendered through the exam-mapping and personalisation layers. Nothing is duplicated to achieve this; only the *rendering context* changes.

---

## 2. Competitive Positioning

This section exists so an implementing AI agent understands **what specifically is being improved upon**, not just abstract architecture.

| Existing product type (e.g. GKToday, gk-hindi, ExamPur, Drishti IAS, NextIAS) | Their limitation | What this platform does differently |
|---|---|---|
| Publish one generic feed/article set for everyone | No personalisation; every visitor sees identical content regardless of goal | Same canonical content is re-rendered per user's followed exams/topics via the Exam Mapping + Personalisation layers |
| Single-exam or single-domain focus (e.g. UPSC-only, SSC-only) | A multi-exam aspirant must visit multiple sites and re-read overlapping material | Multi-Exam Combination Engine (Section 11) unions syllabus requirements and shows each shared knowledge unit once, tagged "Covers: Exam A + Exam B" |
| Depth is fixed per article (either too shallow for a deep exam or too detailed for a basic exam) | Wastes learner time either way | `required_depth` per `ExamMapping`; the same Knowledge Unit renders as a one-line fact, a fact, or a detailed analytical explainer depending on the strictest depth needed by the user's followed exams |
| No structured syllabus mapping — exam pages are just tag/category pages | Users cannot see genuine coverage vs gaps | `SyllabusNode` + `ExamMapping` with relevance/priority/evidence, versioned per `ExamVersion` |
| No true follow/save distinction — bookmarking (if it exists) is generic | No feed personalisation signal, no clear intent capture | `UserFollow` (declared ongoing interest, drives feed/recommendations) vs `SavedItem` (explicit retrieval, drives collections) kept structurally separate |
| Little to no multilingual architecture beyond a translated skin (e.g. a `/hindi/` subfolder that mirrors the English site 1:1) | Cannot scale to new countries/languages without re-building the site | Country and Language are first-class entities from day one; translations reference canonical content, never duplicate it (Section 35) |
| Quizzes/MCQs are disconnected from articles, and disconnected from any exam-depth model | A user cannot revise a topic in one continuous learn → practice → revise loop | `ContentItem` (explainer), `QnA` and `Question`/`MockTest` all reference the same `KnowledgeUnit`, enabling one continuous learning loop (Section 22–23) |
| No coaching-class alternative structure (no mastery tracking, no revision scheduling) | Learners still feel they need paid coaching for structure | Mastery state, revision queue and combined-exam learning mode are explicitly part of the roadmap (Section 22, Phase 7) |

This platform does not aim to be "GKToday but exam-aware." It aims to make the **combination** of broad SEO-friendly discovery, canonical no-duplication knowledge, and true exam-centric personalisation the reason a learner never needs to buy a GK magazine, a current-affairs book, or a generic MCQ booklet again.

---

## 3. Non-Goals

- Do **not** create one independent content database per exam.
- Do **not** create one independent application per country.
- Do **not** treat every article as an exam-specific article.
- Do **not** force all users into exam mode; general/anonymous users must remain first-class.
- Do **not** make AI-generated content the source of truth for factual claims.
- Do **not** rely on user location alone for country identity or for restricting access (see Section 15).
- Do **not** expose editorial/admin functionality through the public application or its public API surface.
- Do **not** make a vector database, Elasticsearch cluster, Kubernetes, or microservices a prerequisite for the first production architecture.
- Do **not** publish digital books or digital magazines as a product form. The platform replaces the *need* for GK books/magazines by being a living, personalised, always-current knowledge system — it does not become a digital reproduction of them.
- Do **not** build every learning feature (mastery, spaced revision, mock test analytics) in Phase 1. The architecture must support them without forcing early implementation.

---

## 4. Platform Surfaces: Web First, App Ready

The user has confirmed: **website first, mobile apps later.** This is a delivery-sequencing decision, not an architecture decision — the domain model and APIs must be designed so the later apps require **no backend redesign**.

Rules for the implementing agent:

- The backend must be **API-first**: every user-facing capability (auth, follow/save, feed, search, exam mapping, quiz/mock test, sharing) is implemented as a versioned internal API (Section 37), and the website consumes those same APIs — it does not have private, undocumented backend shortcuts.
- The web frontend may be a server-rendered or hybrid app (for SEO — see Section 33), but all *authenticated, personalised* functionality must be reachable through the API layer so a future mobile client can reuse it identically.
- Authentication must support token-based sessions (not only cookie sessions) from Phase 1, since mobile apps cannot rely on browser cookies.
- Push notification infrastructure (Section 27) should be modeled generically (channel-agnostic: email, web-push, mobile-push) even though only email/web-push may be implemented first.
- Deep-linkable, stable canonical URLs (Section 16) double as the future basis for mobile app deep links (e.g. `myapp://gk/{topic}/{slug}`), so URL design must not be thrown away when the app is built — it should be mirrored.
- Do not build any native app in the phases covered by this document. This section exists purely so early technical decisions (auth, API boundaries, URL/deep-link design) do not have to be reversed later.

---

## 5. Core Mental Model

The canonical hierarchy is:

```
Country → Language → Knowledge Domain → Topic → Subtopic → Knowledge Unit
       → Content Representation → Exam/Syllabus Mapping → User Context
```

Current affairs additionally attach **time, event, entities, geography, impact and source provenance**.

An **article is a representation**. A **Knowledge Unit** is the reusable semantic object that can be taught, searched, mapped to exams, tested, and revised. This single distinction (expanded in Section 7) is what prevents the platform from collapsing into "one article copy per exam," which is the structural flaw in every existing competitor.

---

## 6. Canonical Domain Model

| Entity | Purpose | Key fields |
|---|---|---|
| **Country** | Global market boundary | id, ISO code, name, default language, supported languages, timezone, status |
| **Language** | Language/localisation boundary | id, locale, name, direction, status |
| **User** | Identity and personalisation | id, country, preferred language, roles, onboarding state, auth method |
| **Exam** | Country-specific exam definition | id, country_id, name, code, organiser, level, status |
| **ExamVersion** | Versioned exam structure | id, exam_id, effective_from, effective_to, source |
| **SyllabusNode** | Exam syllabus tree | id, exam_version_id, parent_id, topic_id, depth, priority, notes |
| **Topic** | Canonical taxonomy node | id, parent_id, type, canonical name, status |
| **KnowledgeUnit** | Atomic reusable knowledge | id, type, canonical topic, fact/body, difficulty, validity |
| **ContentItem** | Publishable representation (article/explainer/fact) | id, knowledge_unit_id, language, format, title, body, status |
| **QnA** | Explanatory question-and-answer content (learning format, not scored) | id, knowledge_unit_id, language, question_text, answer_body, status |
| **Question** | Individual assessment/MCQ object | id, knowledge_unit_id, exam_version_id, difficulty, type, options, correct_answer, explanation |
| **MockTest** | A timed, scoped assembly of Questions | id, title, scope (topic/exam/syllabus_node), question_ids[], duration_minutes, pass_criteria, exam_version_id (optional), status |
| **TestAttempt** | A user's attempt at a MockTest or Quiz | id, user_id, mock_test_id, started_at, submitted_at, answers[], score, per-question correctness |
| **CurrentEvent** | Time-bound event | id, event_date, location, entities, summary, significance, lifecycle_state |
| **Entity** | Person/place/org/concept etc. | id, type, canonical name, aliases, country |
| **Source** | Evidence/provenance | id, publisher, URL, publication date, source type |
| **ExamMapping** | Knowledge-to-exam relationship | knowledge_unit_id, exam_version_id, syllabus_node_id, relevance, priority, required_depth, expected_scope, question_likelihood, source_basis, effective_period, notes |
| **UserFollow** | User follows an object | user_id, object_type, object_id, followed_at |
| **SavedItem** | User saves an object | user_id, object_type, object_id, collection_id, saved_at |
| **Collection** | User-organised saved items | id, user_id, name, visibility |
| **UserGoal/Profile** | Personalisation state | user_id, exam_ids, topics, level, language, preferences |
| **MasteryState** | Per-user, per-Knowledge-Unit/topic proficiency | user_id, knowledge_unit_id, mastery_score, last_reviewed_at, next_review_at |
| **Translation** | Localised representation | source_content_id, source_content_type, language, translated fields, status |
| **ContentFeedback** | User-reported error/quality signal on any content object | id, object_type, object_id, user_id, feedback_type (factual_error, outdated, translation_issue, other), description, status, resolved_by, resolved_at |
| **EditorialTask** | Workflow work item | id, country, language, type, object_id, assignee, status |
| **AuditLog** | Accountability | actor, action, object, timestamp, before/after |
| **SEOPage** | Search landing metadata | canonical URL, title, description, schema, index state |
| **NotificationPreference** | Per-user, per-channel opt-in state | user_id, channel (email/web_push/mobile_push), category, enabled |
| **NotificationEvent** | A triggered, queued notification | id, user_id, trigger_type, object_ref, channel, status, created_at, sent_at |

### Why `MockTest`/`TestAttempt` and `QnA`/`Question` are split (correction from v1.0)

The original spec used a single generic `Question` entity for everything. This is insufficient:

- A **`Question`** is an atomic assessment object (one MCQ), always tied to a `KnowledgeUnit` and optionally an `ExamVersion`, used both standalone (practice) and inside a `MockTest`.
- A **`MockTest`** is a *composed, timed, scoped* assembly of many Questions — this is a structurally different object (it has duration, pass criteria, a defined scope such as "this exam's full syllabus" or "this topic only") and needs its own lifecycle, independent of individual questions.
- A **`TestAttempt`** records a user's specific attempt, score, and per-question correctness — required for mastery tracking (Section 22) and analytics (Section 32).
- A **`QnA`** is a *learning* format (explanatory question-and-answer prose, not scored, not timed) — conceptually closer to a `ContentItem` than to an assessment `Question`. Conflating QnA with Question would incorrectly force explanatory content into a scoring/options schema it doesn't need.

---

## 7. Knowledge Unit vs Content Item

This distinction is mandatory. A **Knowledge Unit** is the canonical semantic record. A **Content Item** (or `QnA`, or `Question`) is a human-readable/assessable representation of that record, in a language and a format.

Example: the canonical knowledge may be "Article 370 — historical background and 2019 abrogation." It can have: a short GK fact, a detailed explainer article, a current-affairs update (at the time of abrogation), revision notes, a QnA entry, and multiple MCQ Questions at different difficulty levels. **These are not separate truths; they are representations of one Knowledge Unit.**

This prevents exam duplication. One Knowledge Unit can map to many exams with different depth requirements (Section 8), and can back many different content formats (Section 23) without the underlying fact ever being re-entered or re-verified twice.

---

## 8. Exam Mapping and the Depth Problem

Do **not** solve exam differences by copying content per exam. Store an **exam requirement layer** instead.

| Field | Meaning |
|---|---|
| `relevance` | Whether the knowledge unit is relevant to this exam/syllabus node |
| `priority` | Importance such as core/supporting/low priority; avoid simplistic universal scoring |
| `required_depth` | one-line, fact, concept, detailed, analytical, etc. |
| `expected_scope` | What portion/aspect is actually relevant |
| `question_likelihood` | Editorial/analytical metadata; not a guaranteed prediction |
| `source_basis` | Why the mapping exists |
| `effective_period` | When the mapping is valid |
| `notes` | Human editorial explanation |

If Exam A needs one line and Exam B needs a deep concept, **both point to the same Knowledge Unit**. The renderer decides how much to show, using the *maximum* `required_depth` across all of a user's followed exams for that unit (Section 11). A user following both exams sees the union of required knowledge, at the highest required depth, rather than duplicate lessons.

Where two exams use genuinely different knowledge, **separate Knowledge Units should exist**. Never artificially merge distinct concepts merely to reduce duplication — deduplication applies to identical canonical knowledge, not to superficially similar topics.

---

## 9. Personalisation System

Personalisation must be layered, explainable and reversible.

- **Explicit signals:** followed exams, followed topics, selected subjects, preferred language, saved items, declared goals.
- **Implicit signals:** reading, completion, quiz/mock-test performance, repeated mistakes, search behaviour and recent activity — subject to privacy settings (Section 31).
- **System state:** country, exam syllabus, content freshness, difficulty and prerequisite relationships.

Recommendation output must be **explainable**, e.g. "Because you follow Exam X" or "Because this topic is weak in your recent mock tests."

Following an exam is a **strong declared intent signal** but must not be treated as proof the user will actually sit the exam — it only drives personalisation, never anything with legal/commercial consequence.

Users can unfollow, change goals and reset personalisation at any time, with an explicit "reset personalisation" control (Section 31).

---

## 10. Follow and Save

Both are core features, and they are **deliberately separate concepts**:

- **Follow:** exam, topic, subject, entity, current-affairs theme, or other supported taxonomy node. Follow affects **feed, notifications, recommendations and dashboard context**.
- **Save:** any eligible content/knowledge unit/QnA/Question/MockTest/current event into a personal **Collection**. Save is an explicit **retrieval/bookmark action** — it must never be treated as a recommendation or personalisation signal by itself.

Rules:
- Default collection: **"Saved."** Custom collections are user-defined (e.g. "Revision," "Important Polity," "Last Week CA").
- Saved objects must retain a **stable reference to the canonical object** so later updates to that object do not create duplicates in the collection.
- Deleted/withdrawn content must display an appropriate **tombstone** in a collection rather than silently corrupting it or disappearing without explanation.

---

## 11. Multi-Exam Combination Engine

This is the central mechanism that solves the "student preparing for RRB Group D and MP Police Constable at the same time" problem. The combined exam view is a **computed view**, never a separately stored syllabus/content database.

**Algorithm:**

1. Collect all exams the user follows, valid for the user's country.
2. Resolve each exam to its active `ExamVersion`.
3. Expand each `ExamVersion`'s `SyllabusNode` tree into its mapped canonical `KnowledgeUnit`s via `ExamMapping`.
4. **Union** the Knowledge Unit IDs across all followed exams.
5. For units shared across exams, retain the **maximum required_depth** and the **set of relevant exams/syllabus nodes** (for the "Covers: Exam A + Exam B" badge).
6. Deduplicate strictly by **canonical Knowledge Unit identity** — never by title/text similarity, which is unreliable.
7. Rank the combined learning queue using user state (mastery, revision due-date), priority, and freshness.
8. Render each item **once**, showing which followed exams it covers.
9. The UI must say **"Covers: Exam A + Exam B"** — never present the same knowledge twice in the same feed/queue.

A user may also choose to view a **single exam's queue only** — the engine must support both single-exam and combined-exam modes without any additional data modeling (it's the same union algorithm, just with one exam in the input set).

See **Appendix A** for a fully worked example.

---

## 12. Current Affairs Architecture

Current affairs should be **event-centric, not article-centric**.

1. Create a `CurrentEvent` for the real-world event/topic.
2. Attach one or more `Source` records.
3. Attach entities, countries, topics and relevant `KnowledgeUnit`s.
4. Create language-specific `ContentItem`s for explanation (and `QnA`/`Question` objects where relevant).
5. Map the event/knowledge to exam syllabus nodes where appropriate, via `ExamMapping`.
6. Support lifecycle states: **emerging → developing → stable → archived**.
7. Allow corrections and source updates with full audit history (Section 36).

This prevents five publishers covering the same event from becoming five unrelated knowledge objects — and lets a current-affairs item flow directly into a followed exam's combined queue the moment it's mapped.

---

## 13. Taxonomy

Use **one global taxonomy framework** with country-specific extensions.

- Top-level domains should include: History, Geography, Polity/Governance, Economy, Science & Technology, Environment, Culture, International Affairs, Sports, Awards, Important Persons, Organisations, Defence/Security, Static GK, and Current Affairs. The exact set must be **configurable**, not hard-coded.
- Taxonomy nodes need stable IDs, parent/child relationships, aliases, descriptions, country applicability, language labels and status.
- Do **not** make exam names part of the canonical taxonomy. Exams map to taxonomy/knowledge exclusively through `SyllabusNode` → `ExamMapping`.

---

## 14. Global + Country Architecture

The application is **one unified product** with country context, not a set of country-specific apps.

- Country is a first-class entity.
- Every `Exam` belongs to exactly one country.
- Every editorial workspace belongs to a country and, optionally, a language.
- Content can be global or country-specific where product rules permit (e.g. "History of the UN" may be global; "Indian Constitution — Article 370" is India-specific).
- Country-specific content must carry an **explicit country scope** field — never inferred from URL alone.
- India is the default/root market; India's default language is English.

---

## 15. Geo and Country Access (Final Decision)

This section **replaces** the original "hard isolation" instinct with a practical, SEO-safe, still fully country-scoped model, per the finalised decision in this conversation.

**Principle:** Geo-location is a **routing and default-context signal**. It is used to route a first-time visitor to the *most relevant* country home page, and to set default content scope — it is **not** used to block access to other countries' public pages. Blanket geo-blocking would (a) break SEO/Googlebot crawling from data-center IPs, (b) break access for diaspora users, students researching another country's exams, and VPN users, and (c) contradict the "global platform" vision. What *is* strictly enforced is **data scoping**, not **network-level access**:

1. On first visit, detect likely country via IP/edge geo where available, and route to that country's home page.
2. Allow **deliberate, explicit country switching** at any time via a language/country switcher — this must always be available, never hidden behind a wall.
3. Country boundaries are enforced at the **data and authorization layer**, not the network layer:
   - Every content query is scoped server-side by `country_id`.
   - A user's account has a home country, but can *browse* another country's public content (useful for a student comparing exams, or researching another country's current affairs) — this is read-only public browsing, no different from visiting a foreign newspaper's website.
   - `Exam`, `SyllabusNode`, editorial roles/permissions, and any user-personalised data **remain strictly scoped** to their owning country — a UK editor can never query or modify India's exam data, and India's exam-following logic never mixes with UK exam data even if a user happens to follow exams flagged to two countries (cross-country exam-following, if ever allowed, would be an explicit separate product decision, not a default).
4. Never rely on frontend URL filtering alone to prevent cross-country data leakage — country scope is enforced in the API/service layer regardless of which URL was used to reach it.
5. Legal/commercial policy questions (e.g., should a user physically located outside India be allowed to create an India-scoped account) are a separate, later product/legal decision — this specification only fixes the **technical** scoping model described above.

---

## 16. URL and SEO Architecture

| Context | Illustrative URL pattern | Rule |
|---|---|---|
| India default English | `/` | India + English defaults omitted |
| India non-default language | `/{language}/` | Only if supported |
| Other country default language | `/{country}/` | Country shown; default language omitted |
| Other country alternate language | `/{country}/{language}/` | Country then language |
| Topic | `/{country-or-root}/{language?}/gk/{topic-slug}/` | Stable canonical topic page |
| Current affairs | `/{country-or-root}/{language?}/current-affairs/{slug}/` | Event/article canonical |
| Exam | `/{country-or-root}/{language?}/exams/{exam-slug}/` | Country-specific exam |
| Syllabus topic | `.../exams/{exam}/syllabus/{topic}/` | Indexable when valuable |
| Knowledge page | `.../gk/{topic}/{slug}/` | Canonical reusable knowledge |
| Quiz/Mock Test | `.../exams/{exam}/mock-tests/{slug}/` | Indexable landing, test itself may be app-gated |

Rules:
- The router must generate canonical URLs from **country + language + object identity**. Never construct URLs by concatenating arbitrary user input.
- One canonical URL per indexable representation.
- `hreflang` between equivalent language pages.
- Canonical tags prevent duplicate parameter pages.
- XML sitemaps segmented by country/language/content type.
- Robots rules must prevent admin/editor/private URLs from indexing.
- Structured data generated where valid: `Article`, `FAQPage` where eligible, `BreadcrumbList`, `WebSite`, `WebPage`, `Quiz`/educational schema types where applicable.
- Search pages with user-specific filters should normally be `noindex` unless there is a deliberate SEO landing-page strategy.
- Create indexable landing pages for high-value topics, exams, syllabus sections and evergreen current-affairs hubs.
- This same route model is the basis for future mobile app deep links (Section 4).

---

## 17. Search Strategy

Search is a first-class product, not merely database text search.

- Exact and prefix matching for names, topics, exams and entities.
- Typo tolerance and aliases.
- Language-aware tokenisation.
- Synonyms and editorial aliases.
- Country-aware filtering.
- Exam-aware boosting when the user follows exams.
- Freshness boosting for current affairs.
- Canonical-object deduplication in results.
- Search results should explain why an item is relevant when useful (e.g. "Matched because it's in your MP Police Constable syllabus").
- A dedicated search engine (e.g. a managed search service) may be introduced when scale requires it (Section 29). The domain model must **not** depend on a specific search vendor.

---

## 18. Editorial / Content Operations

Create a **separate editorial application or protected subdomain/path**. It must never expose admin capabilities through the public student UI.

Roles (each scope-limited by country and, where relevant, language/content domain; RBAC plus scope checks):

- **Global Admin** — platform-wide configuration and controlled support access.
- **Country Admin** — country-specific content, exams, taxonomy extensions and users.
- **Language Editor** — language-scoped content operations.
- **Senior Editor** — review/approve content in assigned scopes.
- **Writer** — create/edit assigned content but cannot publish unless granted.
- **Fact Checker** — verify factual claims and sources.
- **Translator/Localiser** — manage translations.
- **SEO Editor** — metadata, internal linking and indexability.
- **Exam Specialist** — syllabus and exam mappings.
- **Question/Test Author** — creates Questions/QnA/MockTests, distinct from general Writers since this content has a different schema and review path.
- **Analyst/Read-only** — reports without editing.

---

## 19. Editorial Workflow

Recommended workflow:

1. Draft
2. Editorial review
3. Fact/source verification
4. Exam mapping review where applicable
5. Language/localisation review
6. SEO review
7. Scheduled or immediate publish
8. Post-publication monitoring
9. Correction/update (triggered also by `ContentFeedback` — see Section 25)
10. Archive/withdraw

Every transition is audited (`AuditLog`). Published content is **immutable at the revision level**; corrections create a new revision while preserving history (Section 36).

---

## 20. Writer Login and Access

- Writers use a **separate editorial interface**, never a public "writer mode."
- Authentication supports modern identity controls and **MFA for privileged roles**.
- Country Admin creates or invites staff accounts. Each account receives explicit **country/language scopes** and role assignments. The authorization service checks those scopes on **every** protected operation.
- A writer in Country A must never be able to query Country B's content merely by modifying an API parameter — this is enforced server-side (Section 15, Section 30), not by hiding UI elements.

---

## 21. Sharing System

- A share action must exist on every shareable canonical page (Knowledge page, current-affairs item, topic, exam, question, eligible collection).
- Generate stable share URLs.
- Use Open Graph and social metadata.
- Support the Web Share API where available, with a copy-link fallback.
- Share cards identify the content title, topic and platform branding.
- Do **not** expose private saved collections unless explicitly made shareable by the owner.
- Private user data must never appear in public share metadata.
- Track share events as **analytics events**, not as a substitute for real social-network analytics.

---

## 22. Learning & Exam Experience

The platform is not only a content library — it should progressively become a full **coaching-class alternative**.

- **Dashboard:** what matters now (combined-exam queue, due revisions, recent feedback on weak topics).
- **Exam overview:** syllabus coverage and current-affairs relevance.
- **Topic page:** learn → practice → revise, in one continuous flow across `ContentItem` → `QnA`/`Question` → `MockTest`.
- **Knowledge page:** quick fact + deeper explanation + related concepts + sources + exam coverage.
- **QnA layer:** explanatory question-answer content tied to Knowledge Units (learning, not scored).
- **Question/Quiz/Mock Test layer:** scored assessment tied to Knowledge Units and, where relevant, to a specific `ExamVersion`/`SyllabusNode` scope.
- **Mastery state** per Knowledge Unit/topic, derived from `TestAttempt` history.
- **Revision queue** using spaced-review principles where appropriate.
- **Combined-exam mode** with deduplication (Section 11), applied identically to the learning queue and the mock-test scope (e.g. a combined mock test can be scoped to "everything relevant across my followed exams").
- **Current-affairs feed** filtered by followed exams/topics.

Do not build every learning feature in Phase 1 — the architecture must support them all without forcing early implementation (see Phase 7 in Section 40/43).

---

## 23. Content Formats

Canonical content types must include:

- Fact
- Concept
- Explainer
- Current Event
- Timeline
- Person/Entity profile
- Place profile
- Organisation profile
- Comparison
- **QnA** (explanatory, unscored)
- **Question** (scored, MCQ or other assessment type)
- **MockTest** (scored, timed, composed of Questions)
- Revision note
- Source-backed update

Each type has its own schema and validation rules. Avoid a single unstructured HTML blob for all content — this is precisely the anti-pattern this platform must avoid, since it is what makes competitor content impossible to map cleanly to exam syllabi.

When publishing a topic, editorial teams should **not** publish only Questions/QnA — a topic should typically also carry explanatory `ContentItem` content (per the user's explicit requirement), so learners who need context are never left with a bare quiz and no explanation.

---

## 24. Source and Trust Model

Every factual content object should carry provenance appropriate to its type:

- Source publisher/name
- Source URL
- Publication date
- Retrieved/verified date
- Source category
- Editor verification state
- Claim-level or content-level attribution where needed

AI may assist research, extraction, classification, translation or drafting, but **final publishability must be controlled by editorial workflow** for all factual content. Any AI-generated field that affects factual publishing carries provenance/status metadata and requires the appropriate review gate (Section 26).

---

## 25. Content Feedback & Quality Loop

*(New section, addressing a gap in v1.0.)* No knowledge platform can guarantee zero errors at scale — the trust model must include a way for users and editors to catch and correct them quickly.

- Every public content object (Knowledge page, `ContentItem`, `QnA`, `Question`, `CurrentEvent`) has a lightweight **"Report an issue"** action, creating a `ContentFeedback` record (factual_error, outdated, translation_issue, other).
- `ContentFeedback` routes into the editorial workflow (Section 19) as a triggered `EditorialTask`, prioritised by content traffic/importance.
- Resolution status is tracked (`resolved_by`, `resolved_at`) and feeds the **Editorial analytics** family (Section 32: correction rate, time-to-correct).
- This is a **quality signal**, not a personalisation signal, and must never be exposed as public "ratings" that could be gamed — it is a moderation/correction queue, not a review/star-rating feature.

---

## 26. AI Layer

AI is an **augmentation layer over structured truth**, never the database of truth.

Permitted AI-assisted functions:
- Suggest topic classification.
- Suggest exam mappings with confidence and evidence, for editor review.
- Generate draft summaries from approved sources/content.
- Translate/localise drafts.
- Generate question/QnA/mock-test candidates from an approved Knowledge Unit.
- Detect duplicates.
- Detect stale or conflicting information.
- Personalise explanations (rendering variation, not factual invention).
- Triage `ContentFeedback` reports by likely severity.

Hard rule: AI must **never silently invent facts or alter canonical data**. Any AI-generated field affecting factual publishing carries provenance/status and requires the appropriate human review gate before going live.

---

## 27. Notifications

*(Expanded from v1.0 with a minimal concrete contract, since this was previously only a module name.)*

- **Channels:** email, web-push, and mobile-push (mobile-push modeled now, implemented once the app exists — Section 4).
- **Trigger types** (non-exhaustive, extendable):
  - New current-affairs item mapped to a followed exam/topic.
  - New Knowledge Unit added to a followed exam's syllabus coverage.
  - Revision due (from `MasteryState`/spaced-review scheduling).
  - Correction published to a previously read/saved item.
  - Editorial-facing: task assigned, review requested, feedback report received.
- Each `NotificationEvent` references the triggering object, target user, channel and status (queued/sent/failed/read).
- `NotificationPreference` lets users opt in/out **per category and per channel** — notifications must never be all-or-nothing.
- Notification volume must respect the personalisation philosophy: **explainable and controllable**, e.g. "You're getting this because you follow [Topic]" with a one-tap mute for that specific follow.

---

## 28. Recommended Technical Boundary

Phase 1 should use a **modular monolith** or similarly well-bounded application architecture.

Logical modules:

- Identity & Access
- Country & Locale
- Taxonomy
- Knowledge
- Current Affairs
- Exams & Syllabus
- Exam Mapping
- Search
- Personalisation
- Follow & Save
- Questions & Assessment (Questions, MockTests, TestAttempts)
- Editorial
- SEO
- Sharing
- Notifications
- Content Feedback / Quality
- Analytics
- Audit

These modules must have explicit interfaces and clear ownership. The implementation may start in one deployable application. Later, high-load modules (e.g. Search, Questions & Assessment) can be extracted without changing the domain model.

---

## 29. Infrastructure Evolution

Do not wait until the platform is "finished" to think about scalability, but do not prematurely distribute everything. **This is confirmed as the final approach**: build production-quality module boundaries from day one; introduce specialised infrastructure only when measured requirements justify it.

| Technology concern | Initial approach | Scale trigger |
|---|---|---|
| Primary DB | Relational database with strong constraints | Load/partitioning limits |
| Search | Application search or managed search abstraction | Large corpus/latency requirements |
| Cache | Optional cache abstraction | Repeated expensive reads |
| Queue | Background-job abstraction where needed (notifications, AI suggestion jobs) | Long-running/async workloads |
| Object storage | Managed object storage for media | Media volume |
| Vector DB | Optional later semantic layer | Clear semantic-search/recommendation need |
| Microservices | Not required initially | Independent scaling/team/domain needs |
| Kubernetes | Not required initially | Operational/scale requirements |
| Event streaming | Optional later | High-volume event processing |
| Mobile backend needs | Already satisfied by API-first design (Section 4) | N/A — no rework needed at app launch |

The key is **abstraction and boundaries**, not premature infrastructure.

---

## 30. Security

- Secure authentication and session management (token-based, MFA for privileged roles).
- Role-based + scope-based authorization.
- Server-side country enforcement (Section 15).
- Input validation and output encoding.
- CSRF protection where applicable.
- Rate limiting.
- Audit logging for privileged operations.
- Secrets in a secret manager, never in source control.
- Encryption in transit and at rest where appropriate.
- Backups and restore testing.
- Privacy controls and data minimisation.
- Separate public, editorial and administrative surfaces (Section 38).
- Security headers and dependency scanning.

---

## 31. Privacy and User Data

- Personalisation requires careful separation between content data and user-state data.
- Collect only signals needed for product functionality.
- Provide account controls for saved/followed data, including an explicit **"reset personalisation"** control (Section 9).
- Document retention policies.
- Separate analytics identity from public content identity where feasible.
- Allow deletion/export mechanisms where legally required.
- Do **not** use private user data to generate public content.

---

## 32. Analytics

Measure whether the product solves **relevance**, not merely pageviews.

| Metric family | Examples |
|---|---|
| Discovery | search success, topic discovery, organic landing engagement |
| Relevance | follow-to-consumption, exam coverage, recommended-item usefulness |
| Learning | completion, quiz/mock-test accuracy, repeated-error reduction, mastery progression |
| Retention | return sessions, saved-item reuse, revision activity |
| Content | source freshness, correction rate, content usefulness, feedback-report volume/resolution time |
| SEO | indexed pages, impressions, clicks, query coverage |
| Sharing | share actions, landing visits |
| Editorial | time to publish, review cycle, correction cycle |

Avoid optimising solely for raw pageviews — a platform that increases irrelevant page consumption can look successful while failing the core problem this platform exists to solve.

---

## 33. SEO Content Strategy

SEO should capture broad informational intent while routing users into structured, useful experiences — this is the deliberate mechanism for solving the "why does generic content get traffic" question from Section 1.

- Evergreen GK topic pages.
- Country-specific GK hubs.
- Exam pages and syllabus pages.
- Current-affairs event pages.
- Entity pages.
- Topic clusters and internal links.
- QnA/Question pages where genuinely useful and compliant with search-engine policies.
- Freshness signals for current affairs.
- Strong metadata and semantic headings.
- Human-readable, stable URLs.

Search traffic is **acquisition**. Personalisation begins once context is known (login, follows); public landing pages remain useful to anonymous users indefinitely — the two are not in tension, they are sequential layers on the same content.

---

## 34. Homepage Strategy

- Each country homepage must serve as that country's GK/current-affairs **index and discovery hub** — confirmed as a hard requirement.
- India is the root default; other countries have their homepage under their country directory.
- Each homepage includes: country GK categories, current affairs, major topics, exams, popular knowledge, search, language switcher, and a personalised entry point for logged-in users.
- The anonymous homepage is broad and useful; the authenticated homepage progressively becomes personalised (combined-exam queue, followed topics, due revisions) without losing the discovery surface (search, browse) that anonymous users rely on.

---

## 35. Internationalisation

Internationalisation must be **data-driven**, never hard-coded per country.

- Country configuration defines supported languages.
- Language configuration defines locale, formatting, pluralisation, direction and metadata.
- Every translatable content field is versioned.
- **Translations reference canonical source content** rather than duplicating business identity — a Hindi `ContentItem` and an English `ContentItem` both point back to the same `KnowledgeUnit`.
- Do not assume all countries have one language.
- Do not expose a language URL that the country does not support.
- SEO alternate links (`hreflang`) must reflect actual published translations, never a planned/未-published set.
- India: root default, English default, no `/in` or `/en` segment (confirmed, final).
- Other countries: `/{country}/` for default language, `/{country}/{language}/` for alternates — each country exposes **only its own configured languages**, never a global language list.

---

## 36. Content Lifecycle and Versioning

- Use explicit versioning for both exam syllabi and factual content.
- Exam syllabus changes create a new `ExamVersion`.
- Old mappings remain historically queryable.
- Published content revisions preserve previous versions.
- Current affairs can evolve through revisions while maintaining one stable event identity (`CurrentEvent`).
- Taxonomy changes must be migration-safe and audited.
- `ContentFeedback`-triggered corrections also produce a new content revision, never a silent edit.

---

## 37. API Principles

- APIs should be **domain-oriented**, not table-oriented.
- Use stable resource identifiers.
- Enforce country/language scope **server-side** on every call.
- Use pagination and deterministic sorting.
- Use idempotency for publish/import operations where needed.
- Return explicit validation errors.
- Do not expose internal database IDs unnecessarily.
- Version public APIs when breaking changes occur.
- Use authorization checks at the service boundary.
- Since the same API layer will later serve native apps (Section 4), design responses to be **client-agnostic** (no HTML fragments, no web-only assumptions).

---

## 38. Admin vs Editorial vs Public

| Surface | Purpose | Audience |
|---|---|---|
| Public app (web, later + mobile) | Search, browse, learn, exams, current affairs | Everyone |
| Authenticated app | Personalisation, saves, follows, dashboard, mock tests | Users |
| Editorial console | Content, question/test authoring, and exam operations | Writers/editors |
| Admin console | Platform/country/user/config management | Privileged admins |
| Internal APIs | Domain operations | Applications/services |

---

## 39. Mobile App Readiness

*(New section — direct consequence of "website first, app later.")*

The platform must reach a state where building a native app is primarily a **client-development exercise**, not a backend re-architecture:

- All authenticated, personalised features (follow/save, combined-exam queue, mock tests, notifications) must already exist as versioned APIs by the time app development begins.
- Token-based auth (not cookie-only) must exist from Phase 1 so the app can authenticate identically to the web client.
- Canonical URL structure (Section 16) should have an equivalent deep-link mapping ready to document when app work begins.
- Notification infrastructure (Section 27) is channel-agnostic so mobile-push is an additive channel, not a redesign.
- No native app work is scheduled inside the Phase Plan in this document (Section 40) — it is intentionally deferred to a later phase, to be scoped as its own set of sessions once the web platform's vertical slice (Phases 0–9) is stable.

---

## 40. Phase Plan

| Phase | Outcome |
|---|---|
| Phase 0 | Requirements freeze, domain model, architecture contract, UX principles |
| Phase 1 | Foundation: project, auth (token-based), country/language, database, core taxonomy |
| Phase 2 | Knowledge + content + sources + editorial workflow |
| Phase 3 | Exams + syllabus + exam mappings + combined-exam engine |
| Phase 4 | Search + SEO + country homepages + indexable landing pages |
| Phase 5 | User personalisation: follows, saves, profile, dashboard |
| Phase 6 | Current affairs event system + feeds + freshness |
| Phase 7 | QnA, Questions, Mock Tests, mastery and revision |
| Phase 8 | Sharing, notifications, content feedback/quality loop, analytics and growth loops |
| Phase 9 | Multilingual expansion + country launch framework |
| Phase 10 | Scale optimisation, advanced AI assistance and infrastructure evolution |
| Phase 11 (future, out of current scope) | Native mobile app development on existing APIs |

---

## 41. Session Execution Protocol

The project is intentionally divided into sessions. **One AI conversation executes exactly one session.**

At the start of every session, the AI must:

1. Read this master specification.
2. Identify the current phase/session requested by the user.
3. Read the repository state and prior session notes.
4. List assumptions and dependencies only if necessary.
5. Implement **only** the requested session.
6. Run tests/lint/type checks/build checks relevant to the change.
7. Update documentation/migrations/contracts affected by the session.
8. Report: files changed, tests run, known issues, and the exact next-session prerequisite.

The AI must **not** silently start the next session, and must not expand scope beyond what was requested even if it seems like a natural next step.

---

## 42. Session Template

Every session should follow this exact execution structure:

| Section | Required output |
|---|---|
| Goal | One sentence defining the session outcome |
| Inputs | Existing modules/contracts/data required |
| Tasks | Ordered implementation tasks |
| Files | Expected/created/modified files |
| Data | Schema/migration/seed changes |
| API | Endpoints/contracts changed |
| UI | Screens/components changed |
| Tests | Unit/integration/e2e checks |
| Acceptance | Objective pass/fail criteria |
| Docs | Documentation updates |
| Handoff | What the next session may rely on |

---

## 43. Detailed Session Roadmap

| Session | Scope |
|---|---|
| P0-S1 | Freeze product scope, terminology, domain boundaries and acceptance principles. |
| P0-S2 | Define canonical data model, relationships, identifiers and lifecycle states (including `MockTest`, `TestAttempt`, `QnA`, `ContentFeedback`). |
| P0-S3 | Define country/language/URL/routing contract and SEO rules, including the finalised geo-access model (Section 15). |
| P0-S4 | Define roles, RBAC/scope permissions and editorial security model. |
| P0-S5 | Define API conventions (client-agnostic, token-auth-ready), event conventions, testing strategy and repository structure. |
| P1-S1 | Initialize application/repository, environments, configuration and CI. |
| P1-S2 | Implement token-based identity/authentication and base user model. |
| P1-S3 | Implement country and language configuration. |
| P1-S4 | Implement taxonomy foundation and admin CRUD. |
| P1-S5 | Implement audit logging and permission enforcement. |
| P2-S1 | Implement `KnowledgeUnit` model and lifecycle. |
| P2-S2 | Implement `ContentItem` and revisions. |
| P2-S3 | Implement `Source`/provenance model. |
| P2-S4 | Implement editorial workspace and workflow. |
| P2-S5 | Implement canonical knowledge/content rendering. |
| P3-S1 | Implement `Exam` and `ExamVersion`. |
| P3-S2 | Implement `SyllabusNode` hierarchy. |
| P3-S3 | Implement `ExamMapping` and editorial mapping UI. |
| P3-S4 | Implement multi-exam union/deduplication engine (Section 11). |
| P3-S5 | Implement exam-facing pages and coverage display. |
| P4-S1 | Implement search abstraction and indexing pipeline. |
| P4-S2 | Implement country homepages and topic landing pages. |
| P4-S3 | Implement exam/syllabus SEO pages. |
| P4-S4 | Implement canonical URLs, hreflang, sitemap and robots. |
| P4-S5 | Implement metadata/structured data and SEO validation. |
| P5-S1 | Implement follows. |
| P5-S2 | Implement saves and collections. |
| P5-S3 | Implement onboarding/profile and explicit goals. |
| P5-S4 | Implement personalised dashboard/feed. |
| P5-S5 | Implement personalisation explanations and controls (incl. reset). |
| P6-S1 | Implement `CurrentEvent` and source aggregation workflow. |
| P6-S2 | Implement current-affairs publishing and revisions. |
| P6-S3 | Implement current-affairs taxonomy/entity linking. |
| P6-S4 | Implement exam-aware current-affairs feed. |
| P6-S5 | Implement freshness/archive rules. |
| P7-S1 | Implement `QnA` model and rendering. |
| P7-S2 | Implement `Question` model and standalone practice mode. |
| P7-S3 | Implement `MockTest` and `TestAttempt` engine. |
| P7-S4 | Implement mastery tracking and revision queue. |
| P7-S5 | Implement combined-exam learning/mock-test mode. |
| P8-S1 | Implement sharing and share metadata. |
| P8-S2 | Implement notifications engine and preferences. |
| P8-S3 | Implement content feedback/quality-loop pipeline. |
| P8-S4 | Implement product analytics. |
| P8-S5 | Implement editorial/SEO analytics and growth/referral measurement. |
| P9-S1 | Implement translation/localisation framework. |
| P9-S2 | Implement country launch configuration. |
| P9-S3 | Implement country-specific editorial workspaces. |
| P9-S4 | Implement country-specific SEO/indexing operations. |
| P9-S5 | Launch a second country as a complete vertical slice. |
| P10-S1 | Measure performance bottlenecks and optimise. |
| P10-S2 | Introduce dedicated search infrastructure if justified. |
| P10-S3 | Introduce caching/queues/async processing where justified. |
| P10-S4 | Add advanced AI-assisted classification/mapping/deduplication. |
| P10-S5 | Evaluate service extraction only from measured boundaries. |
| P11-S1 (future) | Define mobile app technical scope from stabilised APIs (out of current document's active scope). |

---

## 44. Acceptance Criteria for the Whole Platform

- A single Knowledge Unit can be represented in multiple languages and formats.
- A single Knowledge Unit can map to multiple exams without duplicate canonical content.
- Two followed exams produce **one** combined item where they share the same canonical knowledge, tagged with both exams.
- Different required depths render appropriately without cloning the underlying knowledge.
- Following an exam changes personalised content but never alters the canonical object.
- Saving an item makes it retrievable independently of its feed, and survives underlying content updates without duplication.
- Country scope is enforced server-side, for both content and account data, while public content remains browsable across countries per Section 15.
- India root/default English works without `/in` or `/en`.
- Other countries use country-first URLs, with default-language omission and alternate-language segments.
- Country homepages are indexable country GK/current-affairs hubs.
- Exam pages are country-specific.
- Editorial users can only operate within assigned country/language scopes.
- All published factual content has appropriate source/provenance metadata.
- Public share links never expose private user data.
- SEO metadata/canonicals/hreflang/sitemaps are generated from the same route model.
- A `MockTest` can be scoped to a single exam or to a combined multi-exam set, without duplicating Questions.
- A `ContentFeedback` report on any content object reaches the editorial workflow and is auditable to resolution.
- An AI agent can execute one session without guessing the domain model.
- All authenticated functionality is reachable via versioned, client-agnostic APIs (verifying app-readiness per Section 39).

---

## 45. Seed Data Strategy

The initial seed should be intentionally small but structurally rich:

- India country record.
- English language record as India's default.
- At least a few taxonomy branches.
- Sample exams with versioned syllabus nodes (at least two exams sharing overlapping syllabus, to exercise the combination engine).
- Sample Knowledge Units with different depth requirements.
- Sample mappings where two exams share one Knowledge Unit at different depths (mirroring Appendix A).
- Sample QnA and Question objects tied to the same Knowledge Unit.
- A sample MockTest composed from those Questions, plus one sample TestAttempt.
- Sample current event with multiple sources.
- Sample editorial users with scoped roles.
- Sample translations.
- One sample `ContentFeedback` report, to exercise the quality-loop workflow end-to-end.

Use synthetic/non-sensitive seed content in development. Production ingestion must go through the editorial workflow.

---

## 46. Critical Design Decisions That Must Not Be Reversed Casually

1. Knowledge is canonical; content (including QnA/Questions/MockTests) is representation.
2. Exam mapping is a relationship, not copied content.
3. Multi-exam is a computed union, never a stored duplicate.
4. Country is a first-class scope, enforced server-side — but not a network-level access wall (Section 15).
5. Language is a first-class localisation dimension.
6. Exam syllabus is versioned.
7. Follow and Save are separate concepts.
8. Editorial is a separate, protected surface.
9. AI assists but never becomes the factual source of truth.
10. SEO is part of the domain/routing architecture, not an afterthought.
11. Public, user, editorial and admin surfaces are separated.
12. Start modular; distribute only when justified by measured requirements.
13. All authenticated functionality is API-first, to keep the future mobile app a client-only effort.
14. QnA, Question, and MockTest are structurally distinct entities — never collapse them into one generic "question" table.

---

## 47. What "World Class" Means for This Product

World class means: coherent information architecture, high factual reliability, excellent retrieval, low duplication, useful and explainable personalisation, strong multilingual support, fast UX, accessible content, trustworthy provenance, scalable editorial operations, a real coaching-class alternative learning loop, and measurable learning utility.

It should **not** mean maximum technical complexity. A smaller system with clean domain boundaries is preferable to a distributed system whose behaviour nobody can reason about.

---

## 48. Final AI Instruction

You are an implementation agent. This document is the governing product/domain specification. Do not invent competing architecture unless a documented contradiction or implementation blocker exists. If a contradiction is found, **stop before coding and state the exact conflict**.

When the user says "start Phase X Session Y," execute **only** that session. Do not execute later sessions. Preserve all existing contracts unless the requested session explicitly changes them. Do not delete functionality merely to simplify implementation. Prefer small, testable, reversible changes.

At the end of each session, provide: implementation summary, changed files, schema/API changes, tests, acceptance results, unresolved issues, and the exact next session name. **Wait for explicit instruction before proceeding.**

---

## Appendix A — Example Combined Exam

Suppose Exam A requires "Indian Constitution — basic features" and Exam B requires "Indian Constitution — detailed structure, amendments and case-law context." The system stores one or more canonical Knowledge Units. Both exams map to the relevant unit(s). Exam A's mapping requests a shallower `required_depth`; Exam B's requests a deeper one. A user following both receives the **deeper version once**, with a coverage badge showing both exams ("Covers: Exam A + Exam B"). If a case-law topic is genuinely outside Exam A's syllabus, it remains an **additional** unit mapped only to Exam B, and appears in the combined queue tagged "Exam B only."

This is the central mechanism that prevents duplication while respecting exam-specific depth — directly solving the "RRB Group D + MP Police Constable" case from the original requirement.

---

## Appendix B — Example URL Matrix

| Country | Language | Example |
|---|---|---|
| India | English (default) | `/` |
| India | Hindi | `/hi/` |
| United Kingdom | English (default) | `/uk/` |
| United Kingdom | Welsh | `/uk/cy/` |
| France | French (default) | `/fr/` |
| France | English | `/fr/en/` |
| Japan | Japanese (default) | `/jp/` |
| Japan | English | `/jp/en/` |

These are routing examples, not a claim that every listed country/language must launch. The country configuration determines the actual supported set.

---

## Appendix C — Immediate Build Order

1. Freeze this specification and create the repository architecture contract.
2. Implement country/language/routing foundations before content scale.
3. Implement canonical taxonomy and Knowledge Units.
4. Implement editorial workflow and provenance.
5. Implement exam/syllabus versioning and mappings.
6. Implement multi-exam union engine.
7. Implement SEO/search foundations.
8. Implement follows/saves/personalised dashboard.
9. Implement current affairs.
10. Implement QnA/Question/MockTest assessment layer.
11. Implement sharing, notifications and the content feedback/quality loop.
12. Expand countries/languages only after the complete vertical slice works.
13. Only after Phases 0–9 are stable: scope native mobile app development as its own phase (Section 39).

---

## Appendix D — Competitor Gap Analysis (Summary)

| Gap in today's GK platforms | This platform's structural answer |
|---|---|
| One-size-fits-all content | Knowledge Unit + rendering context (country/language/exam/depth) |
| No multi-exam support | Multi-Exam Combination Engine (Section 11) |
| No real follow/save distinction | `UserFollow` vs `SavedItem`, structurally separate |
| Quizzes disconnected from articles | `ContentItem` / `QnA` / `Question` / `MockTest` all reference the same `KnowledgeUnit` |
| Shallow or fixed-depth articles | `required_depth` per `ExamMapping`, rendered dynamically |
| No error-correction loop for users | `ContentFeedback` → editorial workflow (Section 25) |
| Translated content duplicated per language | `Translation` references canonical content, never duplicates identity |
| No coaching-class replacement structure | Mastery tracking + revision queue + combined learning mode (Section 22) |

---

## Document Status

This is the **master product and implementation specification, v2.0**. It supersedes v1.0 and incorporates: the Mock Test/TestAttempt entity, the QnA/Question split, the finalised (non-blocking) geo/country-access model, web-first/app-ready architecture guidance, competitive positioning, a content feedback/quality loop, and an expanded notifications contract.

It is intended to be handed to an AI coding agent or engineering team as the **sole governing reference**. Session-level implementation specifications should be generated from this document only for the requested session, without automatically advancing the project.
