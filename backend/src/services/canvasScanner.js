// ============================================================================
// Compass - Canvas LMS integration
// Fetches courses and assignments from a school's Canvas instance via the
// Canvas REST API and normalizes them into our event shape.
// ============================================================================

const https = require('https');

/**
 * Normalizes a user-entered Canvas URL into a bare origin, e.g.
 * "yourschool.instructure.com/" -> "https://yourschool.instructure.com".
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeCanvasUrl(rawUrl) {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol;
}

/**
 * Extracts the next-page URL from a Canvas `Link` response header.
 *
 * @param {string|undefined} linkHeader
 * @returns {string|null}
 */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Performs a single authenticated GET against the Canvas API.
 *
 * @param {string} baseUrl - Canvas origin, e.g. "https://school.instructure.com"
 * @param {string} pathOrUrl - Relative API path or an absolute pagination URL
 * @param {string} token - Canvas API access token
 * @returns {Promise<{ data: unknown, nextUrl: string|null }>}
 */
function canvasGet(baseUrl, pathOrUrl, token) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(pathOrUrl, baseUrl);
    } catch (err) {
      reject(new Error(`Invalid Canvas URL: ${err.message}`));
      return;
    }

    const request = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Canvas API error (${response.statusCode}): ${body.slice(0, 300)}`));
            return;
          }

          try {
            resolve({
              data: JSON.parse(body),
              nextUrl: parseNextLink(response.headers.link),
            });
          } catch (parseError) {
            reject(new Error(`Failed to parse Canvas response: ${parseError.message}`));
          }
        });
      },
    );

    request.on('error', reject);
  });
}

/**
 * Follows Canvas's `Link: rel="next"` pagination until exhausted, returning
 * every item across all pages.
 *
 * @param {string} baseUrl
 * @param {string} initialPath
 * @param {string} token
 * @returns {Promise<Array<object>>}
 */
async function fetchAllPages(baseUrl, initialPath, token) {
  let results = [];
  let next = initialPath;

  while (next) {
    const { data, nextUrl } = await canvasGet(baseUrl, next, token);
    results = results.concat(Array.isArray(data) ? data : []);
    next = nextUrl;
  }

  return results;
}

/**
 * Fetches the user's active courses.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<Array<{ id: number, name: string }>>}
 */
function fetchCourses(baseUrl, token) {
  return fetchAllPages(baseUrl, '/api/v1/courses?enrollment_state=active&per_page=100', token);
}

/**
 * Fetches all assignments for a single course.
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {number} courseId
 * @returns {Promise<Array<object>>}
 */
function fetchAssignmentsForCourse(baseUrl, token, courseId) {
  return fetchAllPages(baseUrl, `/api/v1/courses/${courseId}/assignments?per_page=100`, token);
}

/**
 * Strips HTML tags and collapses whitespace in a Canvas rich-text field.
 *
 * @param {string|null|undefined} html
 * @returns {string|null}
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Converts a Canvas assignment (with its parent course name attached) into
 * an `events` table row. Returns null when the assignment has no due date,
 * since it can't be placed on a calendar.
 *
 * @param {object} assignment - Canvas assignment resource, plus `courseName`
 * @param {string} userId
 * @returns {object|null}
 */
function assignmentToEvent(assignment, userId) {
  if (!assignment.due_at) return null;

  const dueDate = new Date(assignment.due_at);
  if (Number.isNaN(dueDate.getTime())) return null;

  const year = dueDate.getFullYear();
  const month = String(dueDate.getMonth() + 1).padStart(2, '0');
  const day = String(dueDate.getDate()).padStart(2, '0');
  const hours = dueDate.getHours();
  const minutes = String(dueDate.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;

  const isQuiz = Array.isArray(assignment.submission_types)
    && assignment.submission_types.includes('online_quiz');

  return {
    user_id: userId,
    title: assignment.courseName
      ? `${assignment.courseName}: ${assignment.name}`
      : assignment.name,
    description: stripHtml(assignment.description),
    raw_date: `${year}-${month}-${day}`,
    event_time: `${hour12}:${minutes} ${suffix}`,
    start_time: dueDate.toISOString(),
    location: null,
    source: 'canvas',
    source_id: `canvas-${assignment.id}`,
    scheduling_type: isQuiz ? 'quiz' : 'assignment',
    priority: 3,
    status: 'pending',
  };
}

module.exports = {
  normalizeCanvasUrl,
  canvasGet,
  fetchCourses,
  fetchAssignmentsForCourse,
  assignmentToEvent,
};
