# MASTER VPS AGENT INSTRUCTION — CURIALY MULTI-COMPONENT INTELLIGENCE & DYNAMIC COMPOSITION SYSTEM

You are the senior AI systems architect and full-stack engineering agent responsible for upgrading **Curialy (curialy.tech)**.

Your task is to implement a genuinely intelligent, modular, multi-component selection and composition system. Do not treat this as a simple component gallery or a fixed template generator.

## 1. Core objective

Curialy will contain a growing library of reusable components, including:

- 100 new graph and data visualization components.
- Previously integrated components.
- Future components added to the platform.
- Web design and UI components.
- Data analytics components.
- Dashboard components.
- Tables, forms, filters, navigation, cards, and other interface elements.
- Engineering and developer interface components.

The system must treat all components as one unified ecosystem.

**Important:** The component library must never be restricted to one batch, one category, or one component family.

When a user submits a prompt, the AI must understand the complete requirement, identify all necessary components, retrieve components from multiple categories and batches, and combine them into one coherent result.

## 2. User-selected tool architecture

Curialy users will first select the tools they want to use.

For example:

- Web Design
- Data Analytics
- Dashboard Builder
- UI/UX Design
- Frontend Development
- Backend Development
- Other available tools

The AI must respect the tools selected by the user.

Example:

A user selects:
- Web Design
- Data Analytics

Then enters:

"Build a modern SaaS analytics dashboard for an AI API platform. Include revenue tracking, API request monitoring, user analytics, model usage comparison, and an interactive sidebar."

The AI should understand that this task requires a combination of web design and data analytics capabilities.

It should dynamically select components from both tool ecosystems.

Do not force the user to manually select every individual component.

The user selects the tools. Curialy's intelligence selects the necessary components.

If an essential capability is unavailable because its tool was not selected, explain what is missing and ask the user to enable it rather than silently using an unavailable capability.

## 3. Dynamic component intelligence

Build an intelligent component selection engine.

When a user submits a prompt, the system must:

1. Understand the user's objective.
2. Identify the type of product or interface being requested.
3. Extract functional requirements.
4. Identify visual and interaction requirements.
5. Determine which selected tools are relevant.
6. Identify all necessary component categories.
7. Search across the entire component library.
8. Retrieve the best matching components.
9. Combine components from different categories and batches.
10. Resolve dependencies and compatibility.
11. Generate a unified implementation plan.
12. Produce the final result.

The AI must think about the complete solution rather than choosing components from a single category.

### Example: SaaS analytics dashboard

A request like this could require:

**Batch A — Navigation**
- Sidebar
- Top navigation
- Breadcrumbs
- Navigation tabs

**Batch B — Data visualization**
- Line chart
- Bar chart
- Area chart
- Donut chart

**Batch C — Analytics**
- KPI cards
- Revenue metrics
- Growth indicators
- Conversion metrics

**Batch D — Data management**
- Data table
- Search
- Filters
- Sorting
- Pagination

**Batch E — User interaction**
- Date picker
- Dropdown
- Tooltips
- Modal dialogs

**Batch F — Dashboard layout**
- Responsive grid
- Card layouts
- Dashboard sections
- Empty states

These are examples, not fixed combinations.

The AI must decide which components are appropriate for each individual request.

It must also be able to select components from 2, 3, 5, or more batches simultaneously.

There must be no artificial maximum of one or two component categories.

## 4. Unified component registry

Create or improve a centralized component registry.

Every component must have structured metadata.

Recommended structure:

```json
{
  "id": "chart-001",
  "name": "Advanced Area Chart",
  "category": "data-visualization",
  "batch": "statistical-charts",
  "tags": [
    "analytics",
    "dashboard",
    "statistics",
    "trend"
  ],
  "description": "An interactive area chart for displaying trends over time.",
  "capabilities": [
    "responsive",
    "interactive",
    "multiple-series"
  ],
  "dependencies": [],
  "compatible_tools": [
    "web-design",
    "data-analytics"
  ],
  "frameworks": [
    "react"
  ],
  "status": "active"
}
```

This is an example schema. Adapt it to the existing project architecture.

Requirements:

- Every component must have a unique ID.
- Categories and batches must be searchable metadata, not hard-coded restrictions.
- Existing components must be preserved.
- New components must register automatically or through a documented registration process.
- The system must support hundreds or thousands of components.
- Components must be discoverable through semantic search and metadata filtering.
- The system must support multiple implementations and framework variants where available.

Never hard-code the current component count as 100.

The library will continue growing.

## 5. Intelligent retrieval system

Implement a hybrid retrieval architecture using:

- Semantic search.
- Keyword search.
- Component metadata.
- Capability matching.
- Tool compatibility.
- Dependency resolution.
- Relevance ranking.

The AI should retrieve only the components needed for the current task.

Do not load the entire component library into every AI prompt.

Do not send hundreds of component implementations to the model unnecessarily.

Use a modular retrieval approach:

**Stage 1 — Intent analysis**

Understand the user's prompt and determine what needs to be built.

**Stage 2 — Component discovery**

Search the complete registry for relevant components.

**Stage 3 — Component ranking**

Rank components based on relevance, functionality, compatibility, quality, and design consistency.

**Stage 4 — Dependency discovery**

Retrieve additional components required by selected components.

**Stage 5 — Dynamic composition**

Combine the retrieved components into one implementation plan.

**Stage 6 — Execution**

Generate the final interface or implementation.

## 6. Cross-category component composition

This is one of the most important requirements.

The system must be capable of mixing different component families.

Examples:

| User request | Possible component combinations |
|---|---|
| Crypto trading dashboard | Trading charts + order book + portfolio cards + transaction table |
| AI API platform | Web UI + model usage charts + API logs + pricing cards |
| E-commerce analytics | Revenue charts + product tables + sales KPIs + filters |
| Project management app | Kanban board + calendar + progress charts + task tables |
| SaaS admin panel | Sidebar + user table + analytics + permissions UI |
| Financial reporting tool | Financial charts + tables + date filters + export controls |

Do not build isolated batch-based generators.

Build one intelligent orchestration system capable of composing across the entire library.

## 7. Design consistency and visual intelligence

Selecting the correct components is not enough.

All selected components must look like they belong to the same product.

The system must coordinate:

- Colors
- Typography
- Spacing
- Border radii
- Shadows
- Backgrounds
- Grid systems
- Component dimensions
- Responsive behavior
- Interaction states
- Animation styles

Create or reuse a shared design-token system.

When multiple components come from different design families, adapt their styling to the active design system without destroying their core functionality.

Avoid generating a dashboard where every card, chart, and section looks like it came from a different website.

## 8. Intelligent component selection example

User prompt:

"Create a premium AI model analytics dashboard where users can compare Claude, GPT, Gemini, and other models, monitor API usage, track spending, and analyze latency."

Expected AI reasoning:

- The user selected Web Design and Data Analytics.
- This is an AI API analytics dashboard.
- A sidebar and top navigation are needed.
- Model comparison requires comparison charts.
- API usage requires time-series visualizations.
- Spending requires financial KPI cards and charts.
- Latency requires statistical visualizations.
- API logs require a data table.
- Date selection and model filters are necessary.
- Responsive dashboard layout is required.

Expected component retrieval:

- Navigation components from the web UI library.
- KPI cards from the dashboard library.
- Comparison charts from the visualization library.
- Financial charts from the financial analytics library.
- Statistical charts from the scientific analytics library.
- Data tables from the UI component library.
- Filters and date pickers from the interaction library.

The system must retrieve these components together and compose them into one cohesive interface.

This is the expected behavior, not a hard-coded workflow.

## 9. Performance and scalability

Curialy must remain fast even as the component library grows.

Implement:

- Lazy component loading.
- On-demand retrieval.
- Metadata indexing.
- Semantic retrieval where available.
- Caching of frequently used components.
- Reusable component instances.
- Dependency-aware loading.
- Efficient context management.
- Separation of component metadata from implementation source.

Never put every component's source code into the default system prompt.

Never load unnecessary component batches.

Never let the growing library unnecessarily increase the token consumption of unrelated tasks.

## 10. Intelligent fallback behavior

If an exact component does not exist:

1. Search for the closest matching component.
2. Determine whether an existing component can be adapted.
3. Check whether multiple components can satisfy the requirement.
4. Generate a new implementation only when necessary.
5. Preserve the newly created component as a reusable library candidate when appropriate.

Do not fabricate component availability.

Do not select irrelevant components simply to increase the number of components used.

Quality and relevance are more important than quantity.

## 11. Testing and validation

After implementation, test the following scenarios:

**Test A — Single-category task**

"Create a modern landing page."

Expected: Primarily web design components.

**Test B — Multi-category task**

"Create a financial analytics dashboard with a modern interface."

Expected: Web design + dashboard + financial visualization + data table components.

**Test C — Complex multi-batch task**

"Create a cryptocurrency trading terminal with portfolio analytics, real-time market charts, order book, trading history, and account settings."

Expected: Multiple batches and categories combined intelligently.

**Test D — Unavailable component**

Request a capability that does not exist in the registry.

Expected: Relevant fallback or new implementation, without pretending an unavailable component already exists.

**Test E — Library expansion**

Add a new component to the registry.

Expected: The component becomes discoverable without redesigning the entire orchestration system.

**Test F — Performance**

Run a simple web design task with hundreds of components available.

Expected: Only relevant components are retrieved.

## 12. Implementation requirements

Before making changes:

1. Inspect the existing Curialy codebase.
2. Understand its architecture and existing agent workflow.
3. Identify the current component registration and retrieval mechanisms.
4. Identify the existing tool-selection system.
5. Identify existing component implementations and preserve them.
6. Identify the best integration points for the new architecture.

Then implement the system using the existing stack and conventions.

Do not unnecessarily rewrite working functionality.

Do not remove existing components.

Do not replace existing features with mock implementations.

Do not create fake integrations or nonfunctional buttons.

Use real component implementations and real retrieval logic.

Write maintainable, modular, production-quality code.

Add tests for the component registry, retrieval engine, dependency resolution, and cross-category composition.

## 13. Final acceptance criteria

The implementation is complete only when:

- All existing components remain available.
- The new 100 components can be registered and discovered.
- Users can select multiple tools.
- The AI can retrieve components across multiple batches.
- The AI can combine multiple categories in one task.
- Component selection is based on user intent.
- The system can dynamically resolve dependencies.
- The resulting interface has consistent styling.
- The component library can grow without modifying core orchestration logic.
- Unnecessary components are not loaded.
- Existing Curialy functionality continues working.

## FINAL ARCHITECTURAL PRINCIPLE

Build Curialy as a **unified, modular, multi-tool AI composition engine**.

Do not think in terms of:

"User selected Data Analytics, so only use Data Analytics components."

Think in terms of:

"The user wants to build a complete product. Which selected tools, component families, capabilities, and reusable implementations are necessary to deliver that product?"

The AI must be free to combine relevant components across multiple categories and batches.

The 100 graph components are only one part of a much larger component ecosystem.

The objective is not to create 100 isolated components. The objective is to make Curialy intelligent enough to understand when, why, and how to combine the right components to build complete, professional products.

**First inspect the existing architecture, then implement this incrementally, test it, and report exactly what was changed, what works, and what remains incomplete.**