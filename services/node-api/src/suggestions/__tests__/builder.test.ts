/**
 * Suggestion Card Builder Tests
 *
 * Tests for building suggestion cards from analysis results
 */

import { buildStalenessCard, buildMergeCard, buildRenameCard } from '../builder.js';
import type { StalenessAssessment, NearDuplicatePair } from '../../scanner/analysis.js';

function testStalenessCardWithLLMReasoning() {
  console.log('\n=== Testing Staleness Card with LLM Reasoning ===');
  let passed = 0;
  let failed = 0;

  const assessment: StalenessAssessment = {
    fileId: 'file-123',
    isStale: true,
    staleByModifiedDays: true,
    staleByAccessDays: false,
    modifiedDaysAgo: 120,
    lastAccessedDaysAgo: null,
    reason: 'File has not been modified in 120 days.',
    llmReasoning: {
      isStale: true,
      confidence: 'high',
      reason: 'This is a draft proposal from Q1 2024.',
      suggestedAction: 'archive',
    },
  };

  const card = buildStalenessCard(assessment);

  if (card.id && card.title === 'Archive stale file' && card.action === 'archive') {
    console.log('✓ Card has correct title and action');
    passed++;
  } else {
    console.log('✗ Card title or action incorrect');
    failed++;
  }

  if (card.fileIds.length === 1 && card.fileIds[0] === 'file-123') {
    console.log('✓ Card contains correct file ID');
    passed++;
  } else {
    console.log('✗ Card file IDs incorrect');
    failed++;
  }

  if (card.confidence === 'high') {
    console.log('✓ Card has correct confidence from LLM');
    passed++;
  } else {
    console.log('✗ Card confidence incorrect');
    failed++;
  }

  if (card.description.includes('120 days')) {
    console.log('✓ Card description contains assessment reason');
    passed++;
  } else {
    console.log('✗ Card description missing reason');
    failed++;
  }

  if (card.generatedAt) {
    console.log('✓ Card has generated timestamp');
    passed++;
  } else {
    console.log('✗ Card missing timestamp');
    failed++;
  }

  return { passed, failed };
}

function testStalenessCardWithoutLLMReasoning() {
  console.log('\n=== Testing Staleness Card without LLM Reasoning ===');
  let passed = 0;
  let failed = 0;

  const assessment: StalenessAssessment = {
    fileId: 'file-456',
    isStale: true,
    staleByModifiedDays: true,
    staleByAccessDays: false,
    modifiedDaysAgo: 95,
    lastAccessedDaysAgo: null,
    reason: 'Rule-based detector flagged stale.',
  };

  const card = buildStalenessCard(assessment);

  if (card.confidence === 'medium') {
    console.log('✓ Card defaults to medium confidence without LLM');
    passed++;
  } else {
    console.log('✗ Card confidence should default to medium');
    failed++;
  }

  if (card.description === 'Rule-based detector flagged stale.') {
    console.log('✓ Card description matches assessment reason');
    passed++;
  } else {
    console.log('✗ Card description does not match');
    failed++;
  }

  return { passed, failed };
}

function testStalenessCardThrowsIfNotStale() {
  console.log('\n=== Testing Staleness Card Error Handling ===');
  let passed = 0;
  let failed = 0;

  const assessment: StalenessAssessment = {
    fileId: 'file-789',
    isStale: false,
    staleByModifiedDays: false,
    staleByAccessDays: false,
    modifiedDaysAgo: 30,
    lastAccessedDaysAgo: 10,
    reason: 'File is recent.',
  };

  try {
    buildStalenessCard(assessment);
    console.log('✗ Should have thrown error for non-stale file');
    failed++;
  } catch (error) {
    if ((error as Error).message.includes('not marked as stale')) {
      console.log('✓ Throws error for non-stale file with correct message');
      passed++;
    } else {
      console.log('✗ Throws error but with wrong message');
      failed++;
    }
  }

  return { passed, failed };
}

function testMergeCardWithHighConfidence() {
  console.log('\n=== Testing Merge Card with High Confidence ===');
  let passed = 0;
  let failed = 0;

  const pair: NearDuplicatePair = {
    left: {
      id: 'file-001',
      name: 'Project Plan v1',
      textContent: 'This is a project plan with goals and milestones.',
    },
    right: {
      id: 'file-002',
      name: 'Project Plan v2',
      textContent: 'This is a project plan with goals and milestones.',
    },
    score: 0.95,
  };

  const card = buildMergeCard(pair, 'high');

  if (card.id && card.title === 'Merge duplicate files' && card.action === 'merge') {
    console.log('✓ Card has correct title and action');
    passed++;
  } else {
    console.log('✗ Card title or action incorrect');
    failed++;
  }

  if (card.fileIds.length === 2 && card.fileIds[0] === 'file-001' && card.fileIds[1] === 'file-002') {
    console.log('✓ Card contains both file IDs');
    passed++;
  } else {
    console.log('✗ Card file IDs incorrect');
    failed++;
  }

  if (card.confidence === 'high') {
    console.log('✓ Card has correct confidence');
    passed++;
  } else {
    console.log('✗ Card confidence incorrect');
    failed++;
  }

  if (card.description.includes('95%')) {
    console.log('✓ Card description contains similarity percentage');
    passed++;
  } else {
    console.log('✗ Card description missing similarity');
    failed++;
  }

  return { passed, failed };
}

function testMergeCardDefaultConfidence() {
  console.log('\n=== Testing Merge Card Default Confidence ===');
  let passed = 0;
  let failed = 0;

  const pair: NearDuplicatePair = {
    left: {
      id: 'file-a',
      name: 'Report',
      textContent: 'Q4 financial report.',
    },
    right: {
      id: 'file-b',
      name: 'Report v2',
      textContent: 'Q4 financial report.',
    },
    score: 0.72,
  };

  const card = buildMergeCard(pair);

  if (card.confidence === 'medium') {
    console.log('✓ Card defaults to medium confidence');
    passed++;
  } else {
    console.log('✗ Card confidence should default to medium');
    failed++;
  }

  if (card.description.includes('72%')) {
    console.log('✓ Card description contains 72% similarity');
    passed++;
  } else {
    console.log('✗ Card description missing correct similarity');
    failed++;
  }

  return { passed, failed };
}

function testMergeCardWithLowSimilarity() {
  console.log('\n=== Testing Merge Card with Low Similarity ===');
  let passed = 0;
  let failed = 0;

  const pair: NearDuplicatePair = {
    left: {
      id: 'file-x',
      name: 'File X',
      textContent: 'content for file x',
    },
    right: {
      id: 'file-y',
      name: 'File Y',
      textContent: 'content for file y',
    },
    score: 0.65,
  };

  const card = buildMergeCard(pair, 'low');

  if (card.description.includes('65%')) {
    console.log('✓ Card description contains 65% similarity');
    passed++;
  } else {
    console.log('✗ Card description missing similarity');
    failed++;
  }

  if (card.confidence === 'low') {
    console.log('✓ Card has low confidence');
    passed++;
  } else {
    console.log('✗ Card confidence should be low');
    failed++;
  }

  return { passed, failed };
}

function testRenameCard() {
  console.log('\n=== Testing Rename Card ===');
  let passed = 0;
  let failed = 0;

  const card = buildRenameCard(
    'file-rename-001',
    'notes-final-v3.doc',
    'project-kickoff-notes-2025.doc',
    'high',
  );

  if (card.action === 'rename' && card.title === 'Rename unclear file') {
    console.log('✓ Card has rename action and title');
    passed++;
  } else {
    console.log('✗ Rename card action/title incorrect');
    failed++;
  }

  if (card.fileIds.length === 1 && card.fileIds[0] === 'file-rename-001') {
    console.log('✓ Card contains single target file');
    passed++;
  } else {
    console.log('✗ Rename card file IDs incorrect');
    failed++;
  }

  if (
    card.description.includes('notes-final-v3.doc') &&
    card.description.includes('project-kickoff-notes-2025.doc')
  ) {
    console.log('✓ Card description includes current and proposed names');
    passed++;
  } else {
    console.log('✗ Rename card description missing name guidance');
    failed++;
  }

  if (card.confidence === 'high') {
    console.log('✓ Card preserves requested confidence');
    passed++;
  } else {
    console.log('✗ Rename card confidence incorrect');
    failed++;
  }

  return { passed, failed };
}

function testCardSchemaValidation() {
  console.log('\n=== Testing Card Schema Validation ===');
  let passed = 0;
  let failed = 0;

  const assessment: StalenessAssessment = {
    fileId: 'test-file',
    isStale: true,
    staleByModifiedDays: true,
    staleByAccessDays: false,
    modifiedDaysAgo: 100,
    lastAccessedDaysAgo: null,
    reason: 'Test reason.',
    llmReasoning: {
      isStale: true,
      confidence: 'high',
      reason: 'Test LLM reason.',
      suggestedAction: 'archive',
    },
  };

  const card = buildStalenessCard(assessment);

  const requiredFields = ['id', 'title', 'description', 'action', 'fileIds', 'confidence', 'generatedAt'] as const;
  const allFieldsPresent = requiredFields.every((field) => field in card && card[field] !== undefined);

  if (allFieldsPresent) {
    console.log('✓ Card has all required fields');
    passed++;
  } else {
    console.log('✗ Card missing required fields');
    failed++;
  }

  if (Array.isArray(card.fileIds) && card.fileIds.length > 0) {
    console.log('✓ fileIds is non-empty array');
    passed++;
  } else {
    console.log('✗ fileIds should be non-empty array');
    failed++;
  }

  if (['high', 'medium', 'low'].includes(card.confidence)) {
    console.log('✓ confidence is valid value');
    passed++;
  } else {
    console.log('✗ confidence should be high/medium/low');
    failed++;
  }

  if (['archive', 'merge', 'rename', 'review'].includes(card.action)) {
    console.log('✓ action is valid value');
    passed++;
  } else {
    console.log('✗ action should be one of archive/merge/rename/review');
    failed++;
  }

  return { passed, failed };
}

function runAllTests() {
  console.log('========================================');
  console.log('Suggestion Card Builder Test Suite');
  console.log('========================================');

  const results = [
    testStalenessCardWithLLMReasoning(),
    testStalenessCardWithoutLLMReasoning(),
    testStalenessCardThrowsIfNotStale(),
    testMergeCardWithHighConfidence(),
    testMergeCardDefaultConfidence(),
    testMergeCardWithLowSimilarity(),
    testRenameCard(),
    testCardSchemaValidation(),
  ];

  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const total = totalPassed + totalFailed;

  console.log('\n========================================');
  console.log('Test Results');
  console.log('========================================');
  console.log(`Total: ${total}`);
  console.log(`Passed: ${totalPassed} ✓`);
  console.log(`Failed: ${totalFailed} ✗`);
  console.log(`Success Rate: ${((totalPassed / total) * 100).toFixed(1)}%`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

runAllTests();
