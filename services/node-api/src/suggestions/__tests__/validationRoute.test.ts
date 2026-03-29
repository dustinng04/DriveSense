/**
 * Dev Validation Route Tests
 *
 * Tests the end-to-end mock context -> suggestion JSON API behavior.
 */

import type { AddressInfo } from 'node:net';
import { createApp } from '../../server.js';
import type { DriveSenseRule } from '../../rules/types.js';

async function testReturnsArchiveMergeRenameCards() {
  console.log('\n=== Testing /dev/suggestions/validate action coverage ===');
  let passed = 0;
  let failed = 0;

  const allowRules: DriveSenseRule[] = [
    { type: 'folder_whitelist', path: '/Shared', platform: 'google_drive' },
    { type: 'filetype_whitelist', allowed_types: ['md'], platform: 'google_drive' },
  ];

  const response = await callValidationApi({
    target: {
      platform: 'google_drive',
      path: '/Shared/Product/spec.md',
      name: 'spec.md',
      fileType: 'md',
    },
    rules: allowRules,
    actions: ['archive', 'merge', 'rename'],
  });

  if (response.status === 200) {
    console.log('✓ API returns success status');
    passed++;
  } else {
    console.log(`✗ Expected 200 status, got ${response.status}`);
    failed++;
  }

  const actions = response.json.suggestions.map((card: { action: string }) => card.action).sort();
  const hasAllActions =
    actions.length === 3 &&
    actions[0] === 'archive' &&
    actions[1] === 'merge' &&
    actions[2] === 'rename';

  if (hasAllActions) {
    console.log('✓ API returns archive/merge/rename cards');
    passed++;
  } else {
    console.log('✗ API did not return expected action set');
    failed++;
  }

  if (response.json.ruleEvaluation?.decision === 'allow') {
    console.log('✓ Rule evaluation allows suggestion generation');
    passed++;
  } else {
    console.log('✗ Expected allow decision in rule evaluation');
    failed++;
  }

  return { passed, failed };
}

async function testReturnsEmptyArrayWhenRulesBlockEverything() {
  console.log('\n=== Testing blocked context returns [] without error ===');
  let passed = 0;
  let failed = 0;

  const blockingRules: DriveSenseRule[] = [
    { type: 'folder_whitelist', path: '/Legal', platform: 'google_drive' },
    { type: 'filetype_whitelist', allowed_types: ['md'], platform: 'google_drive' },
  ];

  const response = await callValidationApi({
    target: {
      platform: 'google_drive',
      path: '/Shared/Product/spec.md',
      name: 'spec.md',
      fileType: 'md',
    },
    rules: blockingRules,
    actions: ['archive', 'merge', 'rename'],
  });

  if (response.status === 200) {
    console.log('✓ API returns 200 when rules block suggestions');
    passed++;
  } else {
    console.log(`✗ Expected 200 status, got ${response.status}`);
    failed++;
  }

  if (Array.isArray(response.json.suggestions) && response.json.suggestions.length === 0) {
    console.log('✓ API returns an empty array when blocked');
    passed++;
  } else {
    console.log('✗ Expected suggestions: [] when blocked');
    failed++;
  }

  if (response.json.ruleEvaluation?.decision === 'skip') {
    console.log('✓ Response includes skip decision from rule engine');
    passed++;
  } else {
    console.log('✗ Expected skip decision in rule evaluation');
    failed++;
  }

  return { passed, failed };
}

async function callValidationApi(body: unknown): Promise<{ status: number; json: any }> {
  const app = createApp();
  const server = app.listen(0);

  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/dev/suggestions/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await response.json();
    return { status: response.status, json };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

async function runAllTests() {
  console.log('========================================');
  console.log('Dev Validation Route Test Suite');
  console.log('========================================');

  const results = [
    await testReturnsArchiveMergeRenameCards(),
    await testReturnsEmptyArrayWhenRulesBlockEverything(),
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

runAllTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
