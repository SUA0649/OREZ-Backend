const { parentPort, workerData } = require('worker_threads');

// The worker receives the flat maps of current and parent files
const { currentFiles, parentFiles } = workerData;

try {
  const changes = [];

  // Check for Modified and Added
  for (const [name, file] of Object.entries(currentFiles)) {
    const oldFile = parentFiles[name];
    
    if (!oldFile) {
      changes.push({ type: 'added', name, newHash: file.hash, oldHash: null });
    } else if (oldFile.hash !== file.hash) {
      changes.push({ type: 'modified', name, newHash: file.hash, oldHash: oldFile.hash });
    }
  }

  // Check for Deleted
  for (const [name, file] of Object.entries(parentFiles)) {
    if (!currentFiles[name]) {
      changes.push({ type: 'deleted', name, newHash: null, oldHash: file.hash });
    }
  }

  // Send the result back to the main thread
  parentPort.postMessage({ success: true, changes });
} catch (error) {
  parentPort.postMessage({ success: false, error: error.message });
}
