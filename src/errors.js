'use strict';

class WorkflowError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'WorkflowError';
    this.httpStatus = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { WorkflowError };
