## Suggestions Module

The `suggestions` module is responsible for building **contextual suggestion cards** from analysis results. It transforms raw intelligence (staleness assessments, duplicate detection) into structured, user-ready cards that the UI can display and act upon.

### Architecture

The module separates concerns cleanly:

- **Types** (`types.ts`): `SuggestionCard` and `SuggestionRequest` schemas
- **Builder** (`builder.ts`): Logic to transform analysis results into cards
- **Public API** (`index.ts`): Exports for external use

### Key Concepts

#### SuggestionCard

The primary output format — everything the UI needs to display and execute an action:

```typescript
interface SuggestionCard {
  id: string;                    // Unique identifier
  title: string;                 // Short action label
  description: string;           // Plain-language explanation
  action: 'archive' | 'merge' | 'rename' | 'review';
  fileIds: string[];             // Files involved
  confidence: 'high' | 'medium' | 'low';
  generatedAt: string;           // ISO 8601 timestamp
}
```

#### Builder Functions

Two main entry points:

1. **`buildStalenessCard(assessment: StalenessAssessment)`**
   - Input: Result from staleness detection
   - Output: Card with action type `'archive'`
   - Confidence inherited from LLM reasoning if available, otherwise `'medium'`

2. **`buildMergeCard(pair: NearDuplicatePair, confidence?: 'high' | 'medium' | 'low')`**
   - Input: Near-duplicate pair with similarity score
   - Output: Card with action type `'merge'`
   - Confidence defaults to `'medium'` if not specified

### Usage Example

```typescript
import { buildStalenessCard, buildMergeCard } from './suggestions/index.js';
import { detectStaleness, detectNearDuplicates } from './scanner/analysis.js';

// For staleness
const assessment = detectStaleness(file);
if (assessment.isStale) {
  const card = buildStalenessCard(assessment);
  // Send card to UI
}

// For duplicates
const pairs = detectNearDuplicates(files, 0.9);
for (const pair of pairs) {
  const card = buildMergeCard(pair, 'high');
  // Send card to UI
}
```

### Design Principles

- **Simple & Stateless**: No dependencies on database or external services
- **Deterministic**: Same input always produces the same output (except for `id` and `generatedAt`)
- **Separated Responsibility**: Builder only formats; analysis is done beforehand
- **LLM-Optional**: Works with or without LLM reasoning (falls back to defaults)

### Testing

All builder functions are tested in `__tests__/builder.test.ts` covering:
- Staleness card generation with/without LLM reasoning
- Merge card generation with various confidence levels
- Error handling for invalid inputs
- Schema validation

Run tests: `npm test`
