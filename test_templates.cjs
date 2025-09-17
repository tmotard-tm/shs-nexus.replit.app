#!/usr/bin/env node

/**
 * Comprehensive Template Testing Script
 * Tests all updated checklist templates for proper loading and functionality
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';

// Test data for each template type
const TEST_TASKS = {
  byov_fleet: '999299ef-66c3-4efd-b544-097414e75842',
  byov_ntao: '96c065d5-2cd0-4844-8fd6-90108fe2057f', 
  day0_fleet: 'bb9d47bf-276d-49a6-a365-613069c76f17',
  day0_assets: '90dec862-4703-4e40-9c2f-9214b617bc7f',
  day0_inventory: 'ed609275-53db-4a2f-9c2b-d916565d5c65'
};

// Expected templates for each test
const EXPECTED_TEMPLATES = {
  byov_fleet: 'fleet_byov_onboarding_v1',
  byov_ntao: 'ntao_byov_inspection_v1',
  day0_fleet: 'fleet_onboarding_day0_v1', 
  day0_assets: 'assets_onboarding_day0_v1',
  day0_inventory: 'inventory_onboarding_day0_v1'
};

let cookies = '';

async function makeRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + endpoint);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies
      }
    };

    const req = http.request(options, (res) => {
      // Store cookies from response
      if (res.headers['set-cookie']) {
        cookies = res.headers['set-cookie'].map(cookie => cookie.split(';')[0]).join('; ');
      }

      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(body);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function login() {
  console.log('🔐 Logging in as FIELD001...');
  const response = await makeRequest('POST', '/api/login', {
    username: 'FIELD001',
    password: 'passwords'
  });
  
  if (response.status === 200) {
    console.log('✅ Login successful');
    return true;
  } else {
    console.log('❌ Login failed:', response.data);
    return false;
  }
}

async function testTaskDetails(taskId, module, testName) {
  console.log(`\n🔍 Testing ${testName} task details...`);
  const response = await makeRequest('GET', `/api/${module}-queue/${taskId}`);
  
  if (response.status === 200) {
    console.log(`✅ ${testName} task retrieved successfully`);
    console.log(`   - Title: ${response.data.title}`);
    console.log(`   - Status: ${response.data.status}`);
    console.log(`   - Workflow Type: ${response.data.workflowType}`);
    
    // Parse and display task data
    try {
      const taskData = JSON.parse(response.data.data || '{}');
      if (taskData.phase) console.log(`   - Phase: ${taskData.phase}`);
      if (taskData.step) console.log(`   - Step: ${taskData.step}`);
      if (taskData.workflowSubtype) console.log(`   - Workflow Subtype: ${taskData.workflowSubtype}`);
    } catch (e) {
      console.log('   - Task data parsing error:', e.message);
    }
    
    return response.data;
  } else {
    console.log(`❌ ${testName} task retrieval failed:`, response.data);
    return null;
  }
}

async function testWorkProgress(taskId, testName) {
  console.log(`\n📊 Testing ${testName} work progress...`);
  const response = await makeRequest('GET', `/api/work-progress/${taskId}`);
  
  if (response.status === 200) {
    console.log(`✅ ${testName} work progress retrieved successfully`);
    console.log(`   - Progress:`, response.data.progress);
    console.log(`   - Checklist State Keys:`, Object.keys(response.data.checklistState || {}));
    return response.data;
  } else {
    console.log(`❌ ${testName} work progress failed:`, response.data);
    return null;
  }
}

async function testSaveProgress(taskId, module, testName) {
  console.log(`\n💾 Testing ${testName} save progress...`);
  
  const progressData = {
    checklistState: {
      'test_step': { completed: true },
      'test_substep': { completed: false }
    },
    stepNotes: {
      'test_step': 'Test note for step'
    },
    substepNotes: {
      'test_substep': 'Test note for substep'
    },
    templateProgress: 50
  };
  
  const response = await makeRequest('PATCH', `/api/work-progress/${taskId}`, progressData);
  
  if (response.status === 200) {
    console.log(`✅ ${testName} save progress successful`);
    return true;
  } else {
    console.log(`❌ ${testName} save progress failed:`, response.data);
    return false;
  }
}

async function testTaskAssignment(taskId, module, testName) {
  console.log(`\n👤 Testing ${testName} task assignment...`);
  
  const response = await makeRequest('PATCH', `/api/queues/${module}/${taskId}/assign`, {
    assigneeId: 'self'
  });
  
  if (response.status === 200) {
    console.log(`✅ ${testName} assignment successful`);
    return true;
  } else {
    console.log(`❌ ${testName} assignment failed:`, response.data);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting comprehensive template testing...\n');
  
  // Login first
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('❌ Cannot proceed without authentication');
    process.exit(1);
  }

  let totalTests = 0;
  let passedTests = 0;

  // Test each template type
  for (const [testType, taskId] of Object.entries(TEST_TASKS)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 TESTING: ${testType.toUpperCase()}`);
    console.log(`${'='.repeat(60)}`);
    
    let module = testType.includes('fleet') ? 'fleet' : 
                testType.includes('ntao') ? 'ntao' : 
                testType.includes('assets') ? 'assets' : 'inventory';
    
    // Test 1: Task Details
    totalTests++;
    const taskDetails = await testTaskDetails(taskId, module, testType);
    if (taskDetails) passedTests++;

    // Test 2: Work Progress  
    totalTests++;
    const workProgress = await testWorkProgress(taskId, testType);
    if (workProgress) passedTests++;

    // Test 3: Task Assignment
    totalTests++;
    const assignmentSuccess = await testTaskAssignment(taskId, module, testType);
    if (assignmentSuccess) passedTests++;

    // Test 4: Save Progress
    totalTests++;
    const saveSuccess = await testSaveProgress(taskId, module, testType);
    if (saveSuccess) passedTests++;
    
    console.log(`\n📈 ${testType} Results: ${passedTests}/${totalTests} tests passed so far`);
  }

  // Final Results
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 FINAL RESULTS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Passed: ${passedTests}/${totalTests} (${Math.round(passedTests/totalTests*100)}%)`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Templates are working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the logs above for details.');
  }
}

// Run the tests
runAllTests().catch(console.error);