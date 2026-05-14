/**
 * Rule Evaluator Tests
 *
 * Tests for blacklist/filetype/keyword behavior and evaluation order.
 */

import { evaluateRules } from '../evaluator.js';
import type { DriveSenseRule, RuleEvaluationTarget } from '../types.js';

const baseTarget: RuleEvaluationTarget = {
  platform: 'google_drive',
  path: '/Shared/Product/Docs/spec.md',
  name: 'spec.md',
  fileType: 'md',
};

function testSkipsWhenBlacklisted() {
  console.log('\n=== Testing folder blacklist enforcement ===');
  let passed = 0;
  let failed = 0;

  const rules: DriveSenseRule[] = [
    { type: 'folder_blacklist', path: '/Shared/Product', platform: 'google_drive' },
    { type: 'filetype_whitelist', allowedTypes: ['md'], platform: 'google_drive' },
  ];

  const result = evaluateRules(rules, baseTarget);
  if (result.decision === 'skip' && result.skipCode === 'folder_blacklisted') {
    console.log('✓ Skips when path is inside blacklist');
    passed++;
  } else {
    console.log('✗ Expected folder_blacklisted skip');
    failed++;
  }

  return { passed, failed };
}

function testBlacklistSkipsWithoutWhitelist() {
  console.log('\n=== Testing blacklist-only behavior ===');
  let passed = 0;
  let failed = 0;

  const rules: DriveSenseRule[] = [
    { type: 'folder_blacklist', path: '/Shared/Product', platform: 'google_drive' },
    { type: 'filetype_whitelist', allowedTypes: ['md'], platform: 'google_drive' },
  ];

  const result = evaluateRules(rules, baseTarget);
  if (result.decision === 'skip' && result.skipCode === 'folder_blacklisted') {
    console.log('✓ Blacklist works without requiring any whitelist');
    passed++;
  } else {
    console.log('✗ Expected folder_blacklisted skip');
    failed++;
  }

  return { passed, failed };
}

function testSkipsWhenFileTypeNotAllowed() {
  console.log('\n=== Testing filetype whitelist enforcement ===');
  let passed = 0;
  let failed = 0;

  const rules: DriveSenseRule[] = [
    { type: 'filetype_whitelist', allowedTypes: ['txt'], platform: 'google_drive' },
  ];

  const result = evaluateRules(rules, baseTarget);
  if (result.decision === 'skip' && result.skipCode === 'filetype_not_allowed') {
    console.log('✓ Skips when file type is not explicitly allowed');
    passed++;
  } else {
    console.log('✗ Expected filetype_not_allowed skip');
    failed++;
  }

  return { passed, failed };
}

function testSkipsWhenKeywordGuardMatches() {
  console.log('\n=== Testing keyword guard enforcement ===');
  let passed = 0;
  let failed = 0;

  const rules: DriveSenseRule[] = [
    { type: 'filetype_whitelist', allowedTypes: ['md'], platform: 'google_drive' },
    { type: 'keyword_guard', keywords: ['spec'], platform: 'google_drive' },
  ];

  const result = evaluateRules(rules, baseTarget);
  if (result.decision === 'skip' && result.skipCode === 'keyword_guard') {
    console.log('✓ Skips when filename matches keyword guard');
    passed++;
  } else {
    console.log('✗ Expected keyword_guard skip');
    failed++;
  }

  return { passed, failed };
}

function testAllowsWhenAllRulesPass() {
  console.log('\n=== Testing allow decision ===');
  let passed = 0;
  let failed = 0;

  const rules: DriveSenseRule[] = [
    { type: 'filetype_whitelist', allowedTypes: ['md'], platform: 'google_drive' },
    { type: 'keyword_guard', keywords: ['contract'], platform: 'google_drive' },
  ];

  const result = evaluateRules(rules, baseTarget);
  if (result.decision === 'allow') {
    console.log('✓ Allows when all checks pass');
    passed++;
  } else {
    console.log('✗ Expected allow decision');
    failed++;
  }

  return { passed, failed };
}

function runAllTests() {
  console.log('========================================');
  console.log('Rule Evaluator Test Suite');
  console.log('========================================');

  const results = [
    testSkipsWhenBlacklisted(),
    testBlacklistSkipsWithoutWhitelist(),
    testSkipsWhenFileTypeNotAllowed(),
    testSkipsWhenKeywordGuardMatches(),
    testAllowsWhenAllRulesPass(),
  ];

  const totalPassed = results.reduce((sum, result) => sum + result.passed, 0);
  const totalFailed = results.reduce((sum, result) => sum + result.failed, 0);
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
