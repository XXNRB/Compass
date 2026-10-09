// ============================================================================
// Compass - Syllabus upload routes
// ============================================================================

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const {
  extractEventsFromSyllabus,
  addEventToGoogleCalendar,
} = require('../services/syllabusScanner');
const { supabase } = require('../config/supabase');
const { findExistingDuplicate } = require('../services/eventDedupe');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/syllabus/upload', upload.single('syllabus'), async (req, res) => {
  const userId = req.session.userId || req.query.userId || (req.body && req.body.userId);
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No syllabus file uploaded' });
  }

  try {
    const courseName = req.body.courseName || null;
    const courseCode = req.body.courseCode || null;
    const courseInfo = { courseName, courseCode };

    // Hash the file content so re-uploading the exact same syllabus is
    // recognized before we even call Claude, instead of relying on fuzzy
    // per-event matching (which misses duplicates when the LLM phrases a
    // title or date slightly differently on a second pass).
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const { data: existingUpload, error: uploadLookupError } = await supabase
      .from('events')
      .select('id')
      .eq('user_id', userId)
      .eq('source', 'syllabus')
      .eq('source_id', fileHash)
      .limit(1)
      .maybeSingle();

    if (uploadLookupError) {
      console.error('Supabase syllabus upload lookup error:', uploadLookupError.message);
    } else if (existingUpload) {
      return res.json({
        success: true,
        duplicate: true,
        total: 0,
        googleCalendarAdded: 0,
        events: [],
        message: 'This syllabus has already been uploaded. No new events were added.',
      });
    }

    // multer's memoryStorage hands us a Buffer; pass it to pdf-parse as-is.
    let pdfText;
    try {
      const pdfResult = await pdfParse(req.file.buffer);
      pdfText = pdfResult.text || '';
    } catch (pdfError) {
      console.error('Syllabus PDF could not be read:', pdfError.message);
      return res.status(400).json({
        success: false,
        message: 'That file could not be read as a PDF. Please upload the syllabus as a PDF file.',
      });
    }
    console.log(`Syllabus text extracted: ${pdfText.length} chars`);

    // Scanned (image-only) PDFs have no text layer; say so instead of
    // reporting "0 events found".
    if (!pdfText.trim()) {
      return res.status(422).json({
        success: false,
        message: 'No text could be read from this PDF. If it is a scanned image, export it as a text PDF and try again.',
      });
    }

    let events;
    try {
      events = await extractEventsFromSyllabus(pdfText, courseInfo);
    } catch (extractError) {
      console.error('Syllabus event extraction failed:', extractError.message);
      return res.status(502).json({
        success: false,
        message: 'Could not extract events from this syllabus. Please try again.',
      });
    }
    let googleCalendarAdded = 0;
    let skippedDuplicates = 0;

    for (const event of events) {
      // Check for duplicate
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('user_id', userId)
        .eq('title', event.eventTitle)
        .eq('raw_date', event.eventDate || '')
        .eq('source', 'syllabus')
        .maybeSingle();

      if (existing) {
        console.log('Skipping duplicate:', event.eventTitle);
        skippedDuplicates += 1;
        continue;
      }

      // Same exam under a different title (e.g. "Midterm Exam" vs
      // "CSE 3302 Midterm Exam"): match on date + type + similar time instead.
      const similar = await findExistingDuplicate(supabase, userId, event);
      if (similar) {
        console.log(`Skipping "${event.eventTitle}": duplicate of existing "${similar.title}"`);
        skippedDuplicates += 1;
        continue;
      }

      const { error } = await supabase.from('events').insert({
        user_id: userId,
        title: event.eventTitle,
        description: event.reasoning || null,
        raw_date: event.eventDate || null,
        event_time: event.eventTime || null,
        location: event.location || null,
        source: 'syllabus',
        source_id: fileHash,
        scheduling_type: event.schedulingType || 'other',
        priority: event.priority || 3,
        status: 'pending',
        start_time: null,
      });

      if (error) {
        console.error('Supabase syllabus insert error:', error.message);
        continue;
      }

      if (event.addToGoogleCalendar === true && req.session.googleTokens) {
        const created = await addEventToGoogleCalendar(req.session.googleTokens, event);
        if (created) googleCalendarAdded += 1;
      }
    }

    res.json({
      success: true,
      duplicate: false,
      total: events.length,
      googleCalendarAdded,
      skippedDuplicates,
      events,
    });
  } catch (error) {
    console.error('Syllabus upload error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to process syllabus upload',
    });
  }
});

module.exports = router;