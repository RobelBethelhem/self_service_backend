import { test } from './checkTest.js';

// Array of usernames to test
const usernames = [
    'Haileeyesus.Mezgebu',
    
];

// Function to test multiple usernames
async function testMultipleUsers() {
    for (const username of usernames) {
        console.log(`\nTesting for username: ${username}`);
        console.log('----------------------------------------');
        
        const result = await test(username);
        
        if (result && result.length > 0) {
            console.log('Results found:');
            result.forEach((record, index) => {
                console.log(`\nRecord ${index + 1}:`);
                console.log('Full Name:', record.FullName);
                console.log('Employee ID:', record.EmployeeId);
                console.log('Position:', record.Postion);
                console.log('Salary:', record.Salary);
                console.log('From:', record.From);
                console.log('To:', record.To);
                console.log('Job Grade:', record.Job_Grade);
            });
        } else {
            console.log('No results found or error occurred');
        }
        console.log('----------------------------------------');
    }
}

// Run the tests
testMultipleUsers().catch(console.error);