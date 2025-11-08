import React, { useState, useEffect } from "react";
import { calculateFileHash, downloadFile, formatFileSize } from "../utils/fileUtils";

/**
 * A component that generates and displays file metadata in a text format
 * 
 * @param {Object} props
 * @param {File[]} props.files - Array of files to process
 * @param {string} props.repoId - Repository identifier
 * @param {string} props.user - Username of the uploader
 * @param {number|null} props.removedFileIndex - Index of recently removed file
 * @param {string} [props.className] - Optional CSS classes
 * @param {Object} [props.labels] - Optional custom labels
 * @param {string} [props.labels.title] - Custom title for the component
 * @param {string} [props.labels.noFiles] - Custom text for no files state
 * @param {string} [props.labels.download] - Custom text for download button
 * 
 * How to use:
 * ```jsx
 * <FileInfoWriter
 *   files={uploadedFiles}
 *   repoId="main-repo"
 *   user="john.doe"
 *   removedFileIndex={removedIndex}
 *   className="my-custom-class"
 *   labels={{
 *     title: "File Information",
 *     noFiles: "Upload files to see details",
 *     download: "Save as Text"
 *   }}
 * />
 * ```
 */
function FileInfoWriter({ 
  files, 
  repoId, 
  user, 
  removedFileIndex,
  className = "",
  labels = {
    title: "File Info (.txt)",
    noFiles: "No files uploaded yet.",
    download: "Download Info File"
  }
}) {
  // Keep track of file entries with their metadata
  const [fileInfoMap, setFileInfoMap] = useState(new Map());
  const [processedFiles, setProcessedFiles] = useState([]);

  /**
   * Process new files and update file info map with metadata
   */
  useEffect(() => {
    const processNewFiles = async () => {
      const newFiles = files.filter(file => !processedFiles.includes(file));
      
      for (const file of newFiles) {
        try {
          const fileHash = await calculateFileHash(file);
          const fileInfo = {
            repo_id: repoId,
            relative_path: "",
            uploaded_by: user,
            file_name: file.name,
            file_size: formatFileSize(file.size),
            file_type: file.type || "unknown",
            file_hash: fileHash,
            uploaded_at: new Date().toLocaleString(),
          };

          setFileInfoMap(prev => new Map(prev).set(file, fileInfo));
          setProcessedFiles(prev => [...prev, file]);
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
        }
      }
    };

    if (files.length > 0) {
      processNewFiles();
    }
  }, [files, repoId, user]);

  /**
   * Sync file info map when files are removed
   */
  useEffect(() => {
    if (removedFileIndex !== null) {
      setProcessedFiles(files);
      setFileInfoMap(prev => {
        const newMap = new Map();
        for (const file of files) {
          if (prev.has(file)) {
            newMap.set(file, prev.get(file));
          }
        }
        return newMap;
      });
    }
  }, [removedFileIndex, files]);

  // Generate formatted text content from file metadata
  const fileInfoText = Array.from(fileInfoMap.values())
    .map(info =>
      Object.entries(info)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
    )
    .join('\n\n');

  /**
   * Handles downloading the file info as a text file
   */
  const handleDownloadTxt = () => {
    downloadFile(fileInfoText, "file_info.txt");
  };

  return (
    <div 
      className={`bg-white border rounded-lg p-4 shadow-lg h-full overflow-y-auto ${className}`}
      aria-labelledby="fileInfoTitle"
    >
      <h2 id="fileInfoTitle" className="text-lg font-semibold mb-3">
        {labels.title}
      </h2>
      <pre 
        className="whitespace-pre-wrap text-sm text-gray-700 min-h-[100px] p-2 bg-gray-50 rounded"
        role="region"
        aria-label="File information text"
      >
        {fileInfoText || labels.noFiles}
      </pre>
      {fileInfoText && (
        <button
          onClick={handleDownloadTxt}
          className="mt-4 bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900 transition-colors focus:ring-2 focus:ring-gray-500"
          aria-label={labels.download}
        >
          {labels.download}
        </button>
      )}
    </div>
  );
}

export default FileInfoWriter;