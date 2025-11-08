import React from "react";

/**
 * A component that displays a list of uploaded files with download and remove options
 * 
 * @param {Object} props
 * @param {File[]} props.files - Array of File objects to display
 * @param {Function} props.onRemove - Callback when a file is removed (receives file index)
 * @param {string} [props.className] - Optional CSS classes for the container
 * @param {string} [props.title] - Optional custom title for the file list
 * @param {Object} [props.labels] - Optional custom labels
 * @param {string} [props.labels.download] - Custom text for download button
 * @param {string} [props.labels.remove] - Custom text for remove button
 * 
 * How to use:
 * ```jsx
 * // Basic usage
 * <FileDownload 
 *   files={uploadedFiles}
 *   onRemove={(index) => handleRemoveFile(index)}
 * />
 * 
 * // With custom styling and labels
 * <FileDownload 
 *   files={uploadedFiles}
 *   onRemove={handleRemoveFile}
 *   className="my-custom-class"
 *   title="Your Documents"
 *   labels={{ 
 *     download: "Get File",
 *     remove: "Delete"
 *   }}
 * />
 * ```
 */
export default function FileDownload({ 
  files, 
  onRemove,
  className = "",
  title = "Uploaded Files",
  labels = {
    download: "Download",
    remove: "Remove"
  }
}) {
  if (files.length === 0) return null;

  /**
   * Initiates file download by creating a temporary URL and triggering a download
   * @param {File} file - The file to download
   */
  const handleDownload = (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`mt-8 ${className}`} aria-labelledby="fileListTitle">
      <h2 id="fileListTitle" className="text-lg font-semibold mb-2">
        {title}
      </h2>
      <ul className="space-y-2" role="list">
        {files.map((file, index) => (
          <li
            key={`${file.name}-${index}`}
            className="flex justify-between items-center bg-white p-3 rounded shadow-sm border transition-shadow hover:shadow-md"
            aria-label={`File: ${file.name}`}
          >
            <span className="truncate flex-1 mr-4" title={file.name}>
              {file.name}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleDownload(file)}
                className="text-sm bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 transition-colors focus:ring-2 focus:ring-green-300"
                aria-label={`${labels.download} ${file.name}`}
              >
                {labels.download}
              </button>
              <button
                onClick={() => onRemove(index)}
                className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition-colors focus:ring-2 focus:ring-red-300"
                aria-label={`${labels.remove} ${file.name}`}
              >
                {labels.remove}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}