// ============================================================================
// Compass - Smart Departure Engine
// Computes a recommended departure time for an approved event with a
// location, using Google's Distance Matrix API for travel time and a
// priority-based buffer.
// ============================================================================

const https = require('https');

const VALID_TRAVEL_MODES = ['driving', 'walking', 'transit', 'bicycling'];

const BUFFER_MINUTES_BY_PRIORITY = {
  5: 20,
  4: 15,
  3: 10,
  2: 5,
  1: 5,
};

/**
 * Priority-based departure buffer, in minutes.
 *
 * @param {number} priority - 1-5 star rating
 * @returns {number}
 */
function getBufferMinutes(priority) {
  const level = Math.min(5, Math.max(1, Number(priority) || 3));
  return BUFFER_MINUTES_BY_PRIORITY[level];
}

/**
 * Parses a human-readable time string ("2:30 PM", "14:00", "9am") into
 * { hours, minutes } in 24-hour form.
 *
 * @param {string|null|undefined} eventTime
 * @returns {{ hours: number, minutes: number }|null}
 */
function parseTimeString(eventTime) {
  if (!eventTime || typeof eventTime !== 'string') return null;
  const match = eventTime.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59) return null;
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return { hours, minutes };
}

/**
 * Builds a local Date for an event's start from its raw_date (YYYY-MM-DD)
 * and event_time. Returns null when there isn't a specific clock time —
 * departure planning needs both a date and a time.
 *
 * @param {string|null|undefined} rawDate
 * @param {string|null|undefined} eventTime
 * @returns {Date|null}
 */
function parseEventDateTime(rawDate, eventTime) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) return null;

  const timeParts = parseTimeString(eventTime);
  if (!timeParts) return null;

  const [, year, month, day] = dateMatch;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  date.setHours(timeParts.hours, timeParts.minutes, 0, 0);
  return date;
}

/**
 * Calls the Google Maps Distance Matrix API for travel time between an
 * origin and destination in a given mode.
 *
 * @param {string} origin
 * @param {string} destination
 * @param {string} mode - driving | walking | transit | bicycling
 * @returns {Promise<{ durationMinutes: number, durationText: string }|null>}
 *   null when the API key is missing or the route can't be computed.
 */
function getTravelTime(origin, destination, mode) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      resolve(null);
      return;
    }

    const params = new URLSearchParams({
      origins: origin,
      destinations: destination,
      mode: VALID_TRAVEL_MODES.includes(mode) ? mode : 'driving',
      key: apiKey,
    });

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

    https
      .get(url, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const element = parsed?.rows?.[0]?.elements?.[0];
            if (parsed.status !== 'OK' || !element || element.status !== 'OK') {
              console.error('Distance Matrix returned no usable route:', parsed.status, element?.status);
              resolve(null);
              return;
            }
            resolve({
              durationMinutes: Math.round(element.duration.value / 60),
              durationText: element.duration.text,
            });
          } catch (err) {
            reject(new Error(`Failed to parse Distance Matrix response: ${err.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

/**
 * Computes the full Smart Departure Engine result for an event, or null
 * when there isn't enough information to do so (no location, no parseable
 * start time, no home address on file, or the Distance Matrix call fails).
 *
 * @param {{ raw_date: string, event_time: string, location: string, priority: number }} event
 * @param {{ home_address: string, travel_mode: string }} preferences
 * @returns {Promise<{ departureTime: Date, travelDurationMinutes: number, travelModeUsed: string }|null>}
 */
async function calculateDeparture(event, preferences) {
  if (!event?.location || !preferences?.home_address) return null;

  const eventStart = parseEventDateTime(event.raw_date, event.event_time);
  if (!eventStart) return null;

  const travelMode = VALID_TRAVEL_MODES.includes(preferences.travel_mode)
    ? preferences.travel_mode
    : 'driving';

  const travel = await getTravelTime(preferences.home_address, event.location, travelMode);
  if (!travel) return null;

  const bufferMinutes = getBufferMinutes(event.priority);
  const departureTime = new Date(
    eventStart.getTime() - (travel.durationMinutes + bufferMinutes) * 60 * 1000,
  );

  return {
    departureTime,
    travelDurationMinutes: travel.durationMinutes,
    travelModeUsed: travelMode,
  };
}

module.exports = {
  VALID_TRAVEL_MODES,
  getBufferMinutes,
  parseEventDateTime,
  getTravelTime,
  calculateDeparture,
};
