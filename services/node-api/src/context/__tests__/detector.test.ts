/**
 * Context Detector Tests
 * 
 * Tests for URL parsing and context detection across platforms
 */

import { contextDetector } from '../detector.js';
import { testUrls, testMetadata } from './fixtures.js';

function testGoogleDriveFolders() {
  console.log('\n=== Testing Google Drive Folders ===');
  let passed = 0;
  let failed = 0;

  for (const test of testUrls.googleDrive.folder) {
    const result = contextDetector.detect(test.url);
    const matches = 
      result.platform === test.expected.platform &&
      result.contextType === test.expected.contextType &&
      result.resourceId === test.expected.resourceId;

    if (matches) {
      console.log(`✓ ${test.url}`);
      passed++;
    } else {
      console.log(`✗ ${test.url}`);
      console.log(`  Expected:`, test.expected);
      console.log(`  Got:`, { platform: result.platform, contextType: result.contextType, resourceId: result.resourceId });
      failed++;
    }
  }

  return { passed, failed };
}

function testGoogleDriveFiles() {
  console.log('\n=== Testing Google Drive Files ===');
  let passed = 0;
  let failed = 0;

  for (const test of testUrls.googleDrive.file) {
    const result = contextDetector.detect(test.url);
    const matches = 
      result.platform === test.expected.platform &&
      result.contextType === test.expected.contextType &&
      result.resourceId === test.expected.resourceId;

    if (matches) {
      console.log(`✓ ${test.url}`);
      passed++;
    } else {
      console.log(`✗ ${test.url}`);
      console.log(`  Expected:`, test.expected);
      console.log(`  Got:`, { platform: result.platform, contextType: result.contextType, resourceId: result.resourceId });
      failed++;
    }
  }

  return { passed, failed };
}

function testGoogleDocs() {
  console.log('\n=== Testing Google Docs/Sheets/Slides/Forms ===');
  let passed = 0;
  let failed = 0;

  for (const test of testUrls.googleDrive.docs) {
    const result = contextDetector.detect(test.url);
    const matches = 
      result.platform === test.expected.platform &&
      result.contextType === test.expected.contextType &&
      result.resourceId === test.expected.resourceId;

    if (matches) {
      console.log(`✓ ${test.url}`);
      passed++;
    } else {
      console.log(`✗ ${test.url}`);
      console.log(`  Expected:`, test.expected);
      console.log(`  Got:`, { platform: result.platform, contextType: result.contextType, resourceId: result.resourceId });
      failed++;
    }
  }

  return { passed, failed };
}

function testNotionPages() {
  console.log('\n=== Testing Notion Pages ===');
  let passed = 0;
  let failed = 0;

  for (const test of testUrls.notion.page) {
    const result = contextDetector.detect(test.url);
    const matches = 
      result.platform === test.expected.platform &&
      result.contextType === test.expected.contextType &&
      result.resourceId === test.expected.resourceId;

    if (matches) {
      console.log(`✓ ${test.url}`);
      passed++;
    } else {
      console.log(`✗ ${test.url}`);
      console.log(`  Expected:`, test.expected);
      console.log(`  Got:`, { platform: result.platform, contextType: result.contextType, resourceId: result.resourceId });
      failed++;
    }
  }

  return { passed, failed };
}

function testUnknownUrls() {
  console.log('\n=== Testing Unknown URLs ===');
  let passed = 0;
  let failed = 0;

  for (const test of testUrls.unknown) {
    const result = contextDetector.detect(test.url);
    const matches = 
      result.platform === test.expected.platform &&
      result.contextType === test.expected.contextType &&
      result.resourceId === test.expected.resourceId;

    if (matches) {
      console.log(`✓ ${test.url}`);
      passed++;
    } else {
      console.log(`✗ ${test.url}`);
      console.log(`  Expected:`, test.expected);
      console.log(`  Got:`, { platform: result.platform, contextType: result.contextType, resourceId: result.resourceId });
      failed++;
    }
  }

  return { passed, failed };
}

function testMetadataHandling() {
  console.log('\n=== Testing Metadata Handling ===');
  let passed = 0;
  let failed = 0;

  const testUrl = testUrls.googleDrive.file[0].url;
  
  const result1 = contextDetector.detect(testUrl, testMetadata.basic);
  if (result1.metadata?.title === testMetadata.basic.title && result1.metadata?.path === testMetadata.basic.path) {
    console.log('✓ Basic metadata preserved');
    passed++;
  } else {
    console.log('✗ Basic metadata not preserved');
    failed++;
  }

  const result2 = contextDetector.detect(testUrl, testMetadata.minimal);
  if (result2.metadata?.title === testMetadata.minimal.title) {
    console.log('✓ Minimal metadata preserved');
    passed++;
  } else {
    console.log('✗ Minimal metadata not preserved');
    failed++;
  }

  const result3 = contextDetector.detect(testUrl);
  if (result3.metadata === undefined) {
    console.log('✓ No metadata when not provided');
    passed++;
  } else {
    console.log('✗ Unexpected metadata present');
    failed++;
  }

  return { passed, failed };
}

function runAllTests() {
  console.log('========================================');
  console.log('Context Detector Test Suite');
  console.log('========================================');

  const results = [
    testGoogleDriveFolders(),
    testGoogleDriveFiles(),
    testGoogleDocs(),
    testNotionPages(),
    testUnknownUrls(),
    testMetadataHandling(),
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
