import React, { useState } from "react";

/**
 * A reusable file upload component that handles both drag & drop and click to upload
 * 
 * @param {Object} props
 * @param {Function} props.onUpload - Called when files are added (receives array of Files)
 * @param {string} [props.className] - Optional CSS classes for the container
 * @param {string} [props.text] - Optional custom text for the upload area
 * @param {string} [props.buttonText] - Optional custom text for the button
 * 
 * How to use:
 * ```jsx
 * // Basic usage
 * <FileUpload onUpload={(files) => console.log('Files:', files)} />
 * 
 * // Custom styling
 * <FileUpload 
 *   onUpload={handleFiles}
 *   className="my-custom-class"
 *   text="Drop your documents here"
 *   buttonText="Browse Files"
 * />
 * ```
 */
export default function FileUpload({ 
  onUpload, 
  className = "",
  text = "Drag & drop files here or click below to select",
  buttonText = "Select Files"
}) {
  const [dragActive, setDragActive] = useState(false);

  /**
   * Handles file drop event by preventing default behavior,
   * resetting drag state, and passing files to onUpload callback
   * @param {React.DragEvent} e - The drag event object
   */
  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    onUpload(files);
  };

  /**
   * Handles file selection through the file input element
   * @param {React.ChangeEvent<HTMLInputElement>} e - The change event object
   */
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    onUpload(files);
  };

  return (
    <div
      className={`${className} p-8 border-2 border-dashed rounded-lg text-center transition-all ${
        dragActive ? "border-blue-500 bg-blue-50" : "border-gray-400"
      }`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => setDragActive(true)}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
      aria-label="File upload area"
      role="button"
      tabIndex={0}
    >
      <p className="text-gray-600 mb-4">
        {text}
      </p>
      <input
        type="file"
        multiple
        onChange={handleFileChange}
        className="hidden"
        id="fileInput"
        aria-label="File input"
      />
      <label
        htmlFor="fileInput"
        className="cursor-pointer bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
      >
        {buttonText}
      </label>
    </div>
  );
}