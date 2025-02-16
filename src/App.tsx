import { useState, useEffect } from "react";
import { EmailDialog } from "./components/email-dialog";

// Declare global types for Google Identity Services
declare global {
    interface Window {
        google: any;
    }
}

const API_URL = import.meta.env.VITE_APP_BASE_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
// const GOOGLE_API_KEY = "AIzaSyAfLHm3aMv1SSplepnpURlCwKp8pKPgQ_c";

const isTokenExpired = (token: string): boolean => {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const currentTime = Math.floor(Date.now() / 1000); // Convert current time to seconds
        return currentTime >= payload.exp; // Compare in seconds since exp is in seconds
    } catch (error) {
        console.error("Error checking token expiry:", error);
        return true; // Assume expired if there's an error
    }
};

function App() {
    const [user, setUser] = useState<{ name: string; email: string; imageUrl: string } | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [role, setRole] = useState("Expert business analyst");
    const [system, setSystem] = useState("Analyze and categorize software descriptions.");
    const [inputColumnIndex, setInputColumnIndex] = useState("A"); // Default column A
    const [outputColumnIndex, setOutputColumnIndex] = useState("B"); // Default column B
    const [outputFormat, setOutputFormat] = useState("One or Two Word Phrase");
    const [result, setResult] = useState("");
    const [loading, setLoading] = useState(false);
    const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<string | null>(null);
    const [manualFileId, setManualFileId] = useState<string>("");
    const [showEmailDialog, setShowEmailDialog] = useState(false);
    const [runCount, setRunCount] = useState<number>(0);
    const [userEmail, setUserEmail] = useState<string | null>(null);

    //  const extractSpreadsheetId = (url: string) => {
    //   const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    //   return match ? match[1] : null;
    //  };

    // Load Google Identity Services
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = () => {
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse,
            });
            window.google.accounts.id.renderButton(document.getElementById("googleSignInButton"), {
                theme: "outline",
                size: "large",
            });
        };
        document.body.appendChild(script);
    }, []); // Run this effect only once on component mount

    const handleCredentialResponse = (response: any) => {
        const token = response.credential;
        setAccessToken(token);
        localStorage.setItem("accessToken", token);
        fetchUserProfile(token);
    };

    const fetchUserProfile = async (token: string) => {
        try {
            const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
            if (!response.ok) {
                throw new Error("Failed to fetch user profile");
            }
            const profile = await response.json();
            setUser({
                name: profile.name,
                email: profile.email,
                imageUrl: profile.picture,
            });
        } catch (error) {
            console.error("Error fetching user profile:", error);
            setAccessToken(null);
            setUser(null);
            localStorage.removeItem("accessToken");
        }
    };

    //  const handleLogin = () => {
    //   window.google.accounts.id.prompt();
    //  };

    const handleLogout = () => {
        setUser(null);
        setAccessToken(null);
        setSelectedSpreadsheet(null);
        localStorage.removeItem("accessToken");
        window.location.reload();
        console.log("User logged out");
    };

    const handleSelectSpreadsheet = async (fileId: string) => {
        setSelectedSpreadsheet(fileId);

        try {
            const response = await fetch(`${API_URL}set-sheet`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file_id: fileId }),
            });

            const result = await response.json();
            alert(`Spreadsheet "${result.file_name}" has been set successfully.`);
        } catch (error) {
            console.error("Error setting spreadsheet:", error);
        }
    };

    useEffect(() => {
        const storedRunCount = localStorage.getItem("runCount");
        const storedEmail = localStorage.getItem("userEmail");
        if (storedRunCount) {
            setRunCount(Number.parseInt(storedRunCount, 10));
        }
        if (storedEmail) {
            setUserEmail(storedEmail);
        }
    }, []);

    const handleEmailSubmit = async (email: string) => {
        try {
            const response = await fetch(`${API_URL}capture-email`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ email }),
            });

            if (response.ok) {
                setShowEmailDialog(false);
                setUserEmail(email);
                localStorage.setItem("userEmail", email);
                executeScript();
            } else {
                alert("Failed to submit email. Please try again.");
            }
        } catch (error) {
            console.error("Error submitting email:", error);
            alert("Failed to submit email. Please try again.");
        }
    };

    const executeScript = async () => {
        setLoading(true);
        setResult("");

        const payload = {
            role,
            file_id: selectedSpreadsheet,
            system,
            input_column_index: inputColumnIndex.charCodeAt(0) - 65,
            output_column_index: outputColumnIndex.charCodeAt(0) - 65,
            output_format: outputFormat,
        };

        try {
            const response = await fetch(`${API_URL}run-script`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            setResult(data.result || "Script executed successfully. Check the sheet!");
        } catch (error) {
            console.error("Error:", error);
            setResult("Failed to run script. Check console for details.");
        } finally {
            setLoading(false);
        }
    };

    const handleRunScript = () => {
        const newRunCount = runCount + 1;
        setRunCount(newRunCount);
        localStorage.setItem("runCount", newRunCount.toString());

        if (newRunCount === 2 && !userEmail) {
            setShowEmailDialog(true);
        } else {
            executeScript();
        }
    };

    const handleColumnChange = (direction: "prev" | "next", type: "input" | "output") => {
        const columns = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A-Z
        const currentIndex = columns.indexOf(type === "input" ? inputColumnIndex : outputColumnIndex);
        const otherIndex = columns.indexOf(type === "input" ? outputColumnIndex : inputColumnIndex);

        let newIndex = currentIndex;
        if (direction === "prev") {
            // When going backwards, keep moving back until we find a valid column
            newIndex = currentIndex - 1;
            while (newIndex >= 0 && newIndex === otherIndex) {
                newIndex--;
            }
        } else if (direction === "next") {
            // When going forwards, keep moving forward until we find a valid column
            newIndex = currentIndex + 1;
            while (newIndex < columns.length && newIndex === otherIndex) {
                newIndex++;
            }
        }

        // Only update if we found a valid index
        if (newIndex >= 0 && newIndex < columns.length) {
            if (type === "input") {
                setInputColumnIndex(columns[newIndex]);
            } else {
                setOutputColumnIndex(columns[newIndex]);
            }
        }
    };

    const handleManualInput = () => {
        if (!manualFileId) {
            alert("Please provide a valid Spreadsheet URL.");
            return;
        }

        const match = manualFileId.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match && match[1]) {
            handleSelectSpreadsheet(match[1]);
        } else {
            alert("Invalid Spreadsheet URL. Ensure it's a valid Google Spreadsheet link.");
        }
    };

    useEffect(() => {
        const storedToken = localStorage.getItem("accessToken");
        if (storedToken) {
            if (isTokenExpired(storedToken)) {
                handleLogout();
            } else {
                setAccessToken(storedToken);
                fetchUserProfile(storedToken);
            }
        }
    }, []);

    useEffect(() => {
        let checkTokenInterval: any = null;
        if (accessToken) {
            // Check token expiry every hour
            checkTokenInterval = setInterval(() => {
                if (isTokenExpired(accessToken)) {
                    handleLogout();
                }
            }, 3600000); // 3600000 milliseconds = 1 hour
        }

        // Cleanup function
        return () => {
            if (checkTokenInterval) {
                clearInterval(checkTokenInterval);
            }
        };
    }, [accessToken]);

    return (
        <div className="min-h-screen bg-gray-100 p-8">
            <div className="max-w-4xl mx-auto bg-white p-6 shadow-lg rounded-lg">
                <h1 className="text-2xl font-bold mb-4 text-center">Run Python Script</h1>

                {!user ? (
                    <div className="flex justify-center items-center w-[100%]" >
                        <div className="w-[30%] text-center flex">
                            <div id="googleSignInButton" className="mt-4 rounded-md w-[70%] parent text-center mx-auto"></div>
                        </div>
                    </div>
                ) : null}

                {user && (
                    <div>
                        <div className="text-center mb-6">
                            <img src={user.imageUrl || "/placeholder.svg"} alt="Profile" className="w-16 h-16 rounded-full mx-auto" />
                            <p className="text-lg font-bold">{user.name}</p>
                            <p className="text-sm text-gray-500">{user.email}</p>
                            <button onClick={handleLogout} className="mt-4 bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600">
                                Logout
                            </button>
                        </div>
                        <div className="mt-4">
                            <label className="block font-medium mb-1">
                                Paste Spreadsheet URL
                                <span className=" ml-2 text-[14px] text-red-500">
                                    Make sure to share your sheet with [service account address] or allow anyone with link to edit
                                </span>
                            </label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="https://docs.google.com/spreadsheets/d/FILE_ID"
                                value={manualFileId}
                                onChange={(e) => setManualFileId(e.target.value)}
                            />
                            <button
                                onClick={handleManualInput}
                                className="w-full bg-green-500 text-white font-bold py-3 rounded-lg hover:bg-green-600 mt-2"
                            >
                                Use Spreadsheet
                            </button>
                        </div>
                    </div>
                )}

                <form className="space-y-6 mt-6">
                    <div>
                        <label className="block font-medium mb-1">
                            Role
                            <span className="text-[14px] text-red-500 ml-2">
                                In a few words, tell the system what it should as an analyst, a saleeperson, a copywriter, and anything you can think
                            </span>
                        </label>
                        <textarea
                            className="w-full h-24 border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                        ></textarea>
                    </div>
                    <div>
                        <label className="block font-medium mb-1">
                            System Instruction
                            <span className="text-[14px] text-red-500 ml-2">
                                Tell the system what to do with the selected data ("Remove LLC suffixes", "Categorize by type")
                            </span>
                        </label>
                        <textarea
                            className="w-full h-24 border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={system}
                            onChange={(e) => setSystem(e.target.value)}
                        ></textarea>
                    </div>
                    <div className="flex gap-7">
                        <div>
                            <label className="block font-medium mb-1">Input Column Index</label>
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    className="px-4 py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600"
                                    onClick={() => handleColumnChange("prev", "input")}
                                    disabled={inputColumnIndex === "A"}
                                >
                                    ◀
                                </button>
                                <span className="text-xl font-semibold">{inputColumnIndex}</span>
                                <button
                                    type="button"
                                    className="px-4 py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600"
                                    onClick={() => handleColumnChange("next", "input")}
                                    disabled={inputColumnIndex === "Z"}
                                >
                                    ▶
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="block font-medium mb-1">Output Column Index</label>
                            <div className="flex items-center gap-4">
                                <button
                                    type="button"
                                    className="px-4 py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600"
                                    onClick={() => handleColumnChange("prev", "output")}
                                    disabled={outputColumnIndex === "A"}
                                >
                                    ◀
                                </button>
                                <span className="text-xl font-semibold">{outputColumnIndex}</span>
                                <button
                                    type="button"
                                    className="px-4 py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-600"
                                    onClick={() => handleColumnChange("next", "output")}
                                    disabled={outputColumnIndex === "Z"}
                                >
                                    ▶
                                </button>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block font-medium mb-1">Output Format</label>
                        <select
                            className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={outputFormat}
                            onChange={(e) => setOutputFormat(e.target.value)}
                        >
                            <option value="Sentence">Sentence</option>
                            <option value="One or Two Word Phrase">One or Two Word Phrase</option>
                            <option value="Three to Five Word Phrase">Three to Five Word Phrase</option>
                        </select>
                    </div>
                    <button
                        type="button"
                        onClick={handleRunScript}
                        disabled={loading}
                        className="w-full bg-blue-500 text-white font-bold py-3 rounded-lg hover:bg-blue-600"
                    >
                        {loading ? "Running..." : "Run Script"}
                    </button>
                </form>

                <h2 className="text-xl font-semibold mt-8">Result:</h2>
                <pre className="bg-gray-100 p-4 rounded-lg border border-gray-300">{result || "No result yet"}</pre>
                <EmailDialog open={showEmailDialog} onClose={() => setShowEmailDialog(false)} onSubmit={handleEmailSubmit} />
            </div>
        </div>
    );
}

export default App;
