/**
 * Creates a downloadable blob URL and triggers file download
 * 
 * @param {string} content - The content to download
 * @param {string} filename - The name of the file to download
 * @param {string} [type="text/plain"] - The MIME type of the file
 */
export const downloadFile = (content, filename, type = "text/plain") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Formats a file size in bytes to a human-readable string
 * 
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size with units (B, KB, MB, GB)
 */
export const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

/**
 * Creates a hash for a file using its content and metadata
 * 
 * @param {File} file - The file to hash (from input or drag&drop)
 * @returns {Promise<string>} - Returns an 8-character hex hash
 * 
 * How to use:
 * const hash = await calculateFileHash(myFile);
 * console.log(hash); // prints something like "a1b2c3d4"
 * 
 * Why we need this:
 * - Creates a unique ID for each file based on content and properties
 * - Helps track files even if they have the same name
 * - Can be used to check if a file was modified
 */
export const calculateFileHash = async (file) => {
  try {
    // We only read the first 64KB of the file to make it fast
    const chunkSize = 64 * 1024;
    const chunk = file.slice(0, chunkSize);
    const arrayBuffer = await chunk.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // This is a simple but effective hash algorithm (djb2-like)
    let hash = 5381;
    for (let i = 0; i < uint8Array.length; i++) {
      hash = ((hash << 5) + hash) + uint8Array[i];
      hash = hash & hash; // Keep it as 32-bit integer
    }
    
    // Add file name, size, and type to make the hash more unique
    const fileProps = file.name + file.size + file.type;
    for (let i = 0; i < fileProps.length; i++) {
      hash = ((hash << 5) + hash) + fileProps.charCodeAt(i);
      hash = hash & hash;
    }
    
    // Convert to 8-character hex string
    return Math.abs(hash).toString(16).padStart(8, '0');
  } catch (error) {
    console.error('Error generating hash:', error);
    return 'hash-error';
  }
};