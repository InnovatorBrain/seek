from flask import Flask, request, jsonify
from flask_cors import CORS
import gspread
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
import requests
import aiohttp
import asyncio
import os
import re  # Add this import
import logging
from datetime import datetime
import time
from requests.exceptions import RequestException
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)
CORS(app)

# Google Sheets Setup
SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
SERVICE_ACCOUNT_FILE = 'services.json'  # Replace with your service account JSON file path

credentials = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
client = gspread.authorize(credentials)

# DeepSeek API Setup
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")  # Replace with your DeepSeek API key
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL")
EMAIL_SPREADSHEET_ID = os.getenv("EMAIL_SPREADSHEET_ID")

        
def is_valid_email(email):
    # Regular expression to validate email format
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def get_email_sheet():
    try:
        # Access the existing Google Sheet by its ID
        spreadsheet_id = EMAIL_SPREADSHEET_ID  # Replace with your actual spreadsheet ID
        spreadsheet = client.open_by_key(spreadsheet_id)
        worksheet = spreadsheet.sheet1  # Access the first sheet
        print("Email sheet accessed successfully.")
        return worksheet
    except Exception as e:
        print(f"Error accessing the spreadsheet: {e}")
        raise Exception("Failed to access the spreadsheet.")


@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint to verify the application is running.
    """
    try:
        return jsonify({"status": "healthy"}), 200
    except Exception as e:
        return jsonify({"status": "unhealthy", "error": str(e)}), 500


@app.route('/capture-email', methods=['POST'])
def capture_email():
    try:
        data = request.json
        email = data.get('email')

        if not email:
            return jsonify({"error": "Email is required"}), 400

        # Validate email format
        if not is_valid_email(email):
            return jsonify({"error": "Invalid email format"}), 400

        # Access the existing email sheet
        worksheet = get_email_sheet()

        # Get all emails in the sheet
        existing_emails = worksheet.col_values(1)  # Assuming emails are in the first column

        # Check if the email already exists
        if email in existing_emails:
            print(f"Email already exists: {email}")
            # Return success message even if the email exists, without appending it
            return jsonify({"message": "Email captured successfully"}), 200

        # Append the email to the sheet
        worksheet.append_row([email])
        print(f"Email added successfully: {email}")
        return jsonify({"message": "Email captured successfully"}), 200

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/set-sheet', methods=['POST'])
def set_sheet():
    """
    Verifies the spreadsheet ID and checks accessibility.
    """
    try:
        data = request.json
        file_id = data.get('file_id')

        if not file_id:
            return jsonify({"error": "No file ID provided"}), 400

        # Verify the file exists using the Drive API
        drive_service = build('drive', 'v3', credentials=credentials)
        file_metadata = drive_service.files().get(fileId=file_id).execute()

        print(f"Spreadsheet verified: {file_metadata.get('name')}")
        return jsonify({
            "message": "Spreadsheet verified successfully",
            "file_name": file_metadata.get('name'),
        }), 200

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500
    

@app.route('/run-script', methods=['POST'])
def run_script():
    start_time = time.time()
    logger.info(f"run_script started at {datetime.now()}")

    async def process_batch(batch, start_row):
        logger.debug(f"Starting to process batch from row {start_row} with {len(batch)} rows.")

        filtered_batch = []
        row_indices = []

        for i, row in enumerate(batch):
            if len(row) > input_column_index and row[input_column_index].strip():
                logger.info(f"Processing row {start_row + i}: {row[input_column_index].strip()}")
                filtered_batch.append(row[input_column_index].strip())
                row_indices.append(i)
            else:
                logger.warning(f"Skipping empty row {start_row + i}")

        if not filtered_batch:
            logger.warning(f"Skipping batch starting at row {start_row}: No valid data")
            return []


        return await process_rows(start_row, row_indices, filtered_batch)

    async def process_rows(start_row, row_indices, content_list):
        logger.info(f"Processing API call for batch starting at row {start_row}, Content count: {len(content_list)}")

        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": f"{system} Provide each output on a new line without numbering."},
                {"role": "user", "content": "\n".join(content_list)},
            ],
            "temperature": 0.7,
        }
        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        }

        try:
            api_start_time = time.time()
            async with aiohttp.ClientSession() as session:
                async with session.post(DEEPSEEK_API_URL, json=payload, headers=headers) as response:
                    api_end_time = time.time()
                    logger.info(f"DeepSeek API call for batch starting at row {start_row} took {api_end_time - api_start_time:.2f} seconds")
                    logger.info(f"Response status code: {response.status}")

                    if response.status != 200:
                        error_text = await response.text()
                        logger.error(f"API error for batch starting at row {start_row}: {error_text}")
                        return []

                    data = await response.json()
                    business_types = data.get('choices', [{}])[0].get('message', {}).get('content', '').strip().split("\n")

                    business_types = business_types[:len(content_list)]
                    if len(business_types) < len(content_list):
                        business_types.extend([''] * (len(content_list) - len(business_types)))

                    business_types = [re.sub(r'^\d+\.\s*', '', bt.strip()) for bt in business_types]

                    logger.info(f"Inferred business types for batch starting at row {start_row}: {business_types[:5]}...")

                    updates = [
                        {
                            'range': f'{chr(65 + output_column_index)}{start_row + row_indices[i]}',
                            'values': [[business_type]]
                        }
                        for i, business_type in enumerate(business_types) if business_type.strip()
                    ]

                    return updates

        except Exception as e:
            logger.exception(f"Error processing batch starting at row {start_row}: {str(e)}")
            return []

    try:
        data = request.json
        logger.info(f"Received data: {data}")

        file_id = data.get('file_id')
        if not file_id:
            logger.error("No file ID provided in the request payload.")
            return jsonify({"error": "No file ID provided"}), 400

        logger.info(f"File ID received: {file_id}")

        input_column_index = data.get('input_column_index', 0)
        output_column_index = data.get('output_column_index', 1)
        role = data.get('role', 'Expert business analyst')
        system = data.get('system', 'Analyze and categorize software descriptions.')
        output_format = data.get('output_format', 'One or Two Word Phrase')

        if output_format == "Sentence":
            system += " Provide the output as a single sentence."
        elif output_format == "One or Two Word Phrase":
            system += " Provide the output as a concise one or two-word phrase."
        elif output_format == "Three to Five Word Phrase":
            system += " Provide the output as a short three to five-word phrase."

        logger.info("Attempting to access the spreadsheet...")
        try:
            spreadsheet = client.open_by_key(file_id)
            worksheet = spreadsheet.sheet1
            all_rows = worksheet.get_all_values()[1:]  
        except gspread.exceptions.APIError as e:
            logger.error(f"Google Sheets API error: {str(e)}")
            return jsonify({"error": "Google Sheets API error", "details": str(e)}), 500
        except Exception as e:
            logger.error(f"Error accessing spreadsheet: {str(e)}")
            return jsonify({"error": "Error accessing spreadsheet", "details": str(e)}), 500

        logger.info(f"Number of rows fetched: {len(all_rows)}")
        

        batch_size = 10 
        num_batches = (len(all_rows) + batch_size - 1) // batch_size  
       


        logger.info("Starting to process all batches sequentially")

        all_updates = []
        for i in range(num_batches):
            start_row = i * batch_size + 2  
            batch = all_rows[i * batch_size:(i + 1) * batch_size]
            updates = asyncio.run(process_batch(batch, start_row))
            if updates:
                all_updates.extend(updates)

        logger.info(f"Finished processing all batches. Total updates: {len(all_updates)}")

        if all_updates:
            try:
                update_start_time = time.time()
                worksheet.batch_update(all_updates)
                update_end_time = time.time()
                logger.info(f"Batch update for {len(all_updates)} rows took {update_end_time - update_start_time:.2f} seconds")
            except gspread.exceptions.APIError as e:
                logger.error(f"Google Sheets API error updating batch: {str(e)}")
            except Exception as e:
                logger.error(f"Unexpected error updating batch: {str(e)}")
        else:
            logger.warning("No updates to apply to the spreadsheet")

        end_time = time.time()
        total_time = end_time - start_time
        logger.info(f"run_script completed at {datetime.now()}. Total execution time: {total_time:.2f} seconds")
        return jsonify({"result": "Script executed successfully", "execution_time": total_time}), 200

    except Exception as e:
        logger.exception(f"Unhandled error in run_script: {str(e)}")
        return jsonify({"error": "Unhandled error", "details": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
