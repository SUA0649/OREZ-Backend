import React, { useState } from "react";
import FileUpload from "./components/FileUpload";
import FileDownload from "./components/FileDownload";
import FileInfoWriter from "./components/FileInfoWriter";
import "./index.css";

export default function App() {
  const [files, setFiles] = useState([]);
  const [user] = useState("current user");
  const [removedFileIndex, setRemovedFileIndex] = useState(null);

  const handleFilesUpload = (newFiles) => {
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (index) => {
    setRemovedFileIndex(index);
    setFiles((prev) => prev.filter((_, i) => i !== index));
    // Reset removedFileIndex after a short delay
    setTimeout(() => setRemovedFileIndex(null), 100);
  };

  return (
    <div className="flex h-screen bg-gray-50 p-8">
      <div className="flex-1 flex flex-col items-center justify-center border-r border-gray-300 pr-8">
        <FileUpload 
          onUpload={handleFilesUpload}
          text="Drop your files here or click to select"
          buttonText="Choose Files"
          className="w-2/3"
        />
        <FileDownload 
          files={files} 
          onRemove={handleRemoveFile}
          className="w-2/3"
          title="Your Files"
          labels={{
            download: "Get File",
            remove: "Delete"
          }}
        />
      </div>

      <div className="w-1/3 pl-8">
        <FileInfoWriter 
          files={files} 
          repoId={1} 
          user={user}
          removedFileIndex={removedFileIndex}
          labels={{
            title: "File Information",
            noFiles: "Upload files to see their details",
            download: "Save as Text"
          }}
        />
      </div>
    </div>
  );
}