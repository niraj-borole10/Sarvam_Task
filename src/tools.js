const str = (name, description, extra = {}) => ({ type: "string", description, ...extra });
const objectParams = (properties, required) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const fn = (name, description, parameters) => ({
  type: "function",
  function: { name, description, parameters },
});

export const TOOL_DEFINITIONS = [
  fn("get_available_slots", "Check appointment slots for a department and date. This is read-only.", objectParams({
    department: str("Department or specialty"),
    date: str("Requested date in YYYY-MM-DD format"),
  }, ["department", "date"])),
  fn("book_appointment", "Book a checked appointment slot after the patient explicitly confirms.", objectParams({
    patient_id: str("Opaque patient identifier from the authenticated clinic system"),
    doctor_id: str("Doctor identifier returned by the scheduling system"),
    slot_datetime: str("ISO 8601 appointment date and time with timezone"),
    language: str("Patient language code"),
    user_confirmed: { type: "boolean", description: "Must be true only after explicit patient confirmation" },
  }, ["patient_id", "doctor_id", "slot_datetime", "language", "user_confirmed"])),
  fn("reschedule_appointment", "Reschedule an appointment after the patient explicitly confirms.", objectParams({
    patient_id: str("Opaque patient identifier"),
    appointment_id: str("Appointment identifier"),
    new_slot_datetime: str("New ISO 8601 date and time with timezone"),
    user_confirmed: { type: "boolean", description: "Must be true only after explicit patient confirmation" },
  }, ["patient_id", "appointment_id", "new_slot_datetime", "user_confirmed"])),
  fn("cancel_appointment", "Cancel an appointment after the patient explicitly confirms.", objectParams({
    patient_id: str("Opaque patient identifier"),
    appointment_id: str("Appointment identifier"),
    user_confirmed: { type: "boolean", description: "Must be true only after explicit patient confirmation" },
  }, ["patient_id", "appointment_id", "user_confirmed"])),
  fn("verify_insurance_cashless", "Submit an administrative cashless insurance verification request.", objectParams({
    patient_id: str("Opaque patient identifier"),
    policy_number: str("Insurance policy number"),
    provider_id: str("Hospital/provider identifier"),
  }, ["patient_id", "policy_number", "provider_id"])),
  fn("check_preauth_status", "Check an existing pre-authorization claim status.", objectParams({
    claim_id: str("Claim or pre-authorization identifier"),
  }, ["claim_id"])),
  fn("send_patient_reminder", "Schedule a patient reminder after the patient explicitly confirms the message and channel.", objectParams({
    patient_id: str("Opaque patient identifier"),
    channel: { type: "string", enum: ["sms", "voice", "whatsapp"] },
    message: str("Reminder text approved for the patient"),
    scheduled_time: str("ISO 8601 scheduled send time with timezone"),
    user_confirmed: { type: "boolean", description: "Must be true only after explicit patient confirmation" },
  }, ["patient_id", "channel", "message", "scheduled_time", "user_confirmed"])),
];

const TOOL_ROUTES = Object.freeze({
  get_available_slots: ["GET", "/v1/appointments/slots"],
  book_appointment: ["POST", "/v1/appointments/book"],
  reschedule_appointment: ["POST", "/v1/appointments/reschedule"],
  cancel_appointment: ["POST", "/v1/appointments/cancel"],
  verify_insurance_cashless: ["POST", "/v1/insurance/cashless/verify"],
  check_preauth_status: ["GET", "/v1/insurance/preauth/status"],
  send_patient_reminder: ["POST", "/v1/reminders"],
});

const requiredStrings = (args, keys) => {
  for (const key of keys) {
    if (typeof args[key] !== "string" || !args[key].trim()) {
      throw new Error(`Invalid or missing tool argument: ${key}`);
    }
  }
};

export async function executeTool(name, args, workflowRequest) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  const route = TOOL_ROUTES[name];
  if (!route) throw new Error(`Unsupported tool: ${name}`);

  const requiredByTool = {
    get_available_slots: ["department", "date"],
    book_appointment: ["patient_id", "doctor_id", "slot_datetime", "language"],
    reschedule_appointment: ["patient_id", "appointment_id", "new_slot_datetime"],
    cancel_appointment: ["patient_id", "appointment_id"],
    verify_insurance_cashless: ["patient_id", "policy_number", "provider_id"],
    check_preauth_status: ["claim_id"],
    send_patient_reminder: ["patient_id", "channel", "message", "scheduled_time"],
  };
  requiredStrings(args, requiredByTool[name]);

  if (["book_appointment", "reschedule_appointment", "cancel_appointment", "send_patient_reminder"].includes(name)
      && args.user_confirmed !== true) {
    throw new Error("Patient confirmation is required before this action");
  }
  if (name === "send_patient_reminder" && !["sms", "voice", "whatsapp"].includes(args.channel)) {
    throw new Error("Unsupported reminder channel");
  }
  if (name === "get_available_slots" && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error("date must use YYYY-MM-DD format");
  }
  if (name === "book_appointment" && Number.isNaN(Date.parse(args.slot_datetime))) {
    throw new Error("slot_datetime must be a valid ISO 8601 date/time");
  }
  if (name === "send_patient_reminder" && Number.isNaN(Date.parse(args.scheduled_time))) {
    throw new Error("scheduled_time must be a valid ISO 8601 date/time");
  }

  const [method, path] = route;
  return workflowRequest(method, path, args, name === "get_available_slots" ? { department: args.department, date: args.date } : name === "check_preauth_status" ? { claim_id: args.claim_id } : undefined);
}
