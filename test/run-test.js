// Run test wrapper that supports ES Modules
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Starting test with ES modules...');

// Run the test with ESM support
const testProcess = spawn('node', [join(__dirname, 'index-test.js')], {
  stdio: 'inherit'
});

testProcess.on('close', (code) => {
  process.exit(code);
});