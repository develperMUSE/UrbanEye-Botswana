# UrbanEye Botswana

**AI-Powered Citizen Reporting and Infrastructure Monitoring System**

UrbanEye Botswana is a web-based community reporting and management platform designed to help citizens report infrastructure and public service problems and enable relevant departments to manage and resolve reported issues.

## Main Features

- Citizen registration and authentication.
- Citizen, Officer and Administrator roles.
- Infrastructure issue reporting.
- Photo capture and image uploads.
- GPS location capture and interactive maps using Leaflet.
- AI-assisted issue classification using Cloudflare AI.
- Department-based issue assignment.
- Issue status tracking: Pending, In Progress and Resolved.
- Community voting on reported issues.
- Notifications and dashboard statistics.
- Issue history and management.

## Technology Stack

- Frontend: HTML, CSS and JavaScript.
- Backend: Node.js and Express.js.
- Database: MySQL.
- AI: Cloudflare AI.
- Mapping: Leaflet.
- Authentication: JSON Web Tokens.
- Password security: bcryptjs.

## Installation

### Requirements

- Node.js
- MySQL Server
- Git

### Setup

1. Clone the repository:

   `git clone https://github.com/YOUR_USERNAME/UrbanEye-Botswana.git`

2. Enter the project folder:

   `cd UrbanEye-Botswana`

3. Install dependencies:

   `npm install`

4. Create a `.env` file in the project root and configure the required database credentials, authentication secrets and AI configuration.

5. Create the MySQL database and import the project's SQL database script when included in the repository.

6. Start the application:

   `npm run dev`

7. Open:

   `http://localhost:5000`

## Project Purpose

UrbanEye Botswana aims to improve communication between citizens and responsible service departments by providing a centralised platform for reporting, tracking and managing community infrastructure problems.

## Security

Environment variables, passwords, API keys and other sensitive credentials must never be uploaded to GitHub.

## Developer

UrbanEye Botswana – Academic Software Development Project.