import type React from "react";
import { useState, useEffect } from "react";

interface EmailDialogProps {
 open: boolean;
 onClose: () => void;
 onSubmit: (email: string) => void;
}

export function EmailDialog({ open, onClose, onSubmit }: EmailDialogProps) {
 const [email, setEmail] = useState("");

 useEffect(() => {
  const handleEscape = (event: KeyboardEvent) => {
   if (event.key === "Escape") {
    onClose();
   }
  };

  if (open) {
   document.addEventListener("keydown", handleEscape);
  }

  return () => {
   document.removeEventListener("keydown", handleEscape);
  };
 }, [open, onClose]);

 const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  onSubmit(email);
  setEmail("");
 };

 if (!open) return null;

 return (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
   <div className="bg-white rounded-lg p-6 w-full max-w-md">
    <h2 className="text-xl font-semibold mb-4">Enter your email to continue</h2>
    <form onSubmit={handleSubmit}>
     <input
      type="email"
      placeholder="Enter your email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      required
      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
     />
     <div className="flex justify-end space-x-2">
      <button
       type="button"
       onClick={onClose}
       className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
       Cancel
      </button>
      <button
       type="submit"
       className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
      >
       Submit
      </button>
     </div>
    </form>
   </div>
  </div>
 );
}
