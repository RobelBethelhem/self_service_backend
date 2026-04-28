import { Router } from "express";

import Experiance from "../../models/rms/Experiance_Letter.js";
import Embassy    from "../../models/rms/Letter_of_Embassy.js";
import Guaranty   from "../../models/rms/Guaranty_Letter.js";
import Supportive from "../../models/rms/Supportive_Letter.js";
import SalaryIncrementLetter from "../../models/rms/SalaryIncrementLetter.js";

const router = Router();

// Salary increment letters share a single per-batch reference_number across many
// employees, so the QR code on each printed letter encodes the letter's Mongo _id
// instead. We detect that case by checking if the incoming ref is a 24-char hex
// ObjectId and route the lookup accordingly.
const isObjectId = (s) => typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);

// The route accepts both styles of caller:
//   GET /verify?ref=<x>   (frontend's VerifyLetter page calls this shape)
//   GET /verify/<x>       (path-segment style; reserved for direct API consumers)
// Query takes precedence; path param is the fallback.
router.get(["/verify", "/verify/*"], async (req, res) => {
  try {
    const ref = (req.query && req.query.ref) || req.params[0];
    if (!ref) {
      return res.status(400).json({ valid: false, reason: "missing_ref" });
    }

    const baseProjection = {
      employee_first_name: 1,
      employee_middle_name: 1,
      employee_last_name: 1,
      request_type: 1,
      status: 1,
      viewed_date: 1,
      reference_number: 1,
    };

    // Guaranty additionally has revoked_date
    const guarantyProjection = { ...baseProjection, revoked_date: 1 };

    const [exp, emb, gua, sup, sib] = await Promise.all([
      Experiance.findOne({ reference_number: ref }, baseProjection).lean(),
      Embassy.findOne({ reference_number: ref }, baseProjection).lean(),
      Guaranty.findOne({ reference_number: ref }, guarantyProjection).lean(),
      Supportive.findOne({ reference_number: ref }, baseProjection).lean(),
      isObjectId(ref)
        ? SalaryIncrementLetter.findById(ref).populate("import_batch_id").lean()
        : Promise.resolve(null),
    ]);

    // Salary increment letter: different state machine, different payload mapping.
    if (sib) {
      const employee_name = sib.employee_name || "";
      const batchRef = sib.import_batch_id && sib.import_batch_id.reference_number
        ? sib.import_batch_id.reference_number
        : null;
      return res.json({
        valid: sib.status === "Committed",
        status: sib.status,
        letter_type: "SalaryIncrement",
        reference_number: batchRef,
        employee_name,
        issued_date:
          sib.status === "Committed" || sib.status === "Revoked"
            ? sib.commitment_date || null
            : null,
        rejected_date: null,
        revoked_date: sib.revoked_date || null,
        fiscal_year: sib.fiscal_year,
        category: sib.category,
      });
    }

    const hit = exp || emb || gua || sup;
    if (!hit) {
      return res.status(404).json({ valid: false, reason: "not_found" });
    }

    const employee_name = [
      hit.employee_first_name,
      hit.employee_middle_name,
      hit.employee_last_name,
    ]
      .filter(Boolean)
      .join(" ");

    const payload = {
      valid: hit.status === "Viewed",
      status: hit.status,
      letter_type: hit.request_type,
      reference_number: hit.reference_number,
      employee_name,
      // viewed_date carries the approval date for "Viewed"/"Revoked" letters,
      // and the rejection date for "Rejected" letters.
      issued_date:
        hit.status === "Viewed" || hit.status === "Revoked"
          ? hit.viewed_date || null
          : null,
      rejected_date: hit.status === "Rejected" ? hit.viewed_date || null : null,
      revoked_date: hit.revoked_date || null,
    };

    return res.json(payload);
  } catch (e) {
    console.error("public verify error:", e);
    return res.status(500).json({ error: true, message: "Internal Server Error" });
  }
});

export default router;