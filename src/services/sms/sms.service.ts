import { Request, Response } from "express";
import twilio, { twiml } from "twilio";
import db from "../../db/db";
import {
  GetPhoneOptInsQuery,
  OPT_IN_KEYWORDS,
  OPT_OUT_KEYWORDS,
  PHONE_OPT_IN_TYPE,
  PostSmsBody,
  PutPhoneOptInBody,
  formatClaimInventoryMessage,
  optInMessage,
} from "./sms.model";
import {
  TWILIO_AUTH_TOKEN,
  TWILIO_SID,
  TWILIO_SEND_FROM,
  TWILIO_WEBHOOK_URL,
} from "../../env";
import { sendSms, sendVCard } from "./twilio.service";

/**
 * handles the twilio webhook, to optionally respond with a message.
 *
 * if the response message is not set a response should not be triggered
 *
 * @param {Request} request express request
 * @param {Response} response express response
 * @returns {Promise<void>} void promise
 */
export const handleTwilioSms = async (
  request: Request,
  response: Response
): Promise<void> => {
  try {
    console.log("handle twilio ", JSON.stringify(request.headers));
    const isTwilio = twilio.validateRequest(
      TWILIO_AUTH_TOKEN,
      request.headers["x-twilio-signature"] as string,
      TWILIO_WEBHOOK_URL,
      request.body
    );
    if (!isTwilio) {
      console.error("!isTwilio on twilio webhook post");
      response.status(403).send();
      return;
    }
    const phoneNumber = request.body.From;
    const message = request.body.Body;
    const messageSender = request.body.From;
    let responseMessage: string = "Thanks for the message -Disc Rescue Network";

    if (message && typeof message === "string") {
      const testMessage = message.trim().toLowerCase();
      if (OPT_OUT_KEYWORDS.includes(testMessage)) {
        const dbResponse = await db.putPhoneOptIn({
          id: phoneNumber,
          optIn: 0,
        });
        if ("errors" in dbResponse) {
          response.status(500).send();
          console.error(
            `ERROR: ${messageSender} opted out but failed to update database`
          );
          return;
        }
        response.status(418).send();
        return;
      } else {
        const optInStatus = await smsGetOptInStatus(phoneNumber);
        if (OPT_IN_KEYWORDS.includes(testMessage)) {
          if (optInStatus !== 1) {
            const dbResponse = await db.putPhoneOptIn({
              id: phoneNumber,
              optIn: 1,
            });
            if ("errors" in dbResponse) {
              response.status(500).send();
              console.error(
                `ERROR: ${messageSender} opted in but failed to update database`
              );
              return;
            }
            await sendVCard(
              phoneNumber,
              "DRN: Save our contact to make sure you get all the latest updates from Disc Rescue Network!"
            );
          }
        } else {
          // check opt in before sending message if not a opt in/out keyword
          if (optInStatus === 0) {
            response.status(418).send();
            return;
          } else if (optInStatus === null) {
            await sendSms(phoneNumber, optInMessage);
            response.status(418).send();
            return;
          }
        }
        const currentInventoryForUser = await smsGetCurrentUnclaimedInventory(
          phoneNumber
        );
        const { length } = currentInventoryForUser;
        responseMessage = formatClaimInventoryMessage(length);
      }
    } else {
      console.error(
        `post at /twilio/opt-in does not have message data ${JSON.stringify(
          request.body
        )}`
      );
    }

    const twilioResponse = new twiml.MessagingResponse();
    twilioResponse.message(responseMessage);
    response.type("text/xml").status(200).send(twilioResponse.toString());
  } catch (e) {
    console.error("error on twilio opt in ", e);
    response.status(500).send();
  }
};

/**
 * respond to a request with entries from phone-opt-ins
 *
 * @param {Request} request express request
 * @param {Response} response express response
 * @returns {Promise<void>} void promise
 */
export const getPhoneOptIns = async (
  request: Request,
  response: Response
): Promise<void> => {
  const query = request.query as GetPhoneOptInsQuery;
  const dbResponse = await db.getPhoneOptIns(query.phone, query.smsConsent);
  if ("errors" in dbResponse) {
    console.error(dbResponse, "errors in dbResponse (getPhoneOptIns)");
    response.status(500).send(dbResponse);
    return;
  }
  const { data } = dbResponse;
  if (!Array.isArray(data)) {
    response.status(500).send();
    return;
  }
  response.status(200).send({
    data: data.map((e) => ({
      type: PHONE_OPT_IN_TYPE,
      id: e.id,
      attributes: { smsConsent: e.sms_consent },
    })),
  });
};

/**
 * handle request to put a new phone-opt-in
 *
 * @param {Request} request express request
 * @param {Response} response express response
 * @returns {Promise<void>} void promise
 */
export const putPhoneOptIn = async (
  request: Request,
  response: Response
): Promise<void> => {
  const body = request.body as PutPhoneOptInBody;
  const dbResponse = await db.putPhoneOptIn({
    id: body.data.id,
    optIn: body.data.attributes.smsConsent,
  });
  if ("errors" in dbResponse) {
    console.error(dbResponse, "errors in dbResponse (putPhoneOptIn)");
    response.status(500).send(dbResponse);
    return;
  }
  response.status(200).send(body);
};

export const smsGetOptInStatus = async (
  phoneNumber: string
): Promise<0 | 1 | null> => {
  const optInStatusResponse = await db.getPhoneOptIns([phoneNumber], undefined);
  if ("errors" in optInStatusResponse) {
    throw new Error(JSON.stringify(optInStatusResponse.errors));
  }
  const optInStatus =
    Array.isArray(optInStatusResponse.data) &&
    optInStatusResponse.data.length === 1
      ? (optInStatusResponse.data[0] as Record<"sms_consent", 1 | 0>)
          .sms_consent
      : null;
  return optInStatus;
};

/**
 * get the unclaimed inventory for a phone number
 *
 * @param phoneNumber
 * @returns object[]
 */
export const smsGetCurrentUnclaimedInventory = async (
  phoneNumber: string
): Promise<object[]> => {
  const currentInventoryForUser = await db.getInventory(
    undefined,
    undefined,
    undefined,
    [phoneNumber],
    undefined,
    undefined,
    undefined,
    undefined,
    ["UNCLAIMED", "NEW"],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [0],
    undefined,
    undefined
  );
  if ("errors" in currentInventoryForUser) {
    throw new Error(JSON.stringify(currentInventoryForUser.errors));
  }
  const { data } = currentInventoryForUser;
  if (!Array.isArray(data) || !data.every((e) => typeof e === "object")) {
    throw new Error("unexpected response currentInventoryForUser");
  }
  return data;
};

/**
 * handle post /sms to send a new text
 *
 * @param {Request} request express request
 * @param {Response} response express response
 * @returns
 */
export const postSms = async (request: Request, response: Response) => {
  const postSmsRequestBody = request.body as PostSmsBody;
  const sendSmsResponse = await sendSms(
    postSmsRequestBody.data.phone,
    postSmsRequestBody.data.message
  );
  if (typeof sendSmsResponse === "object" && "errors" in sendSmsResponse) {
    response.status(500).send("Error sending sms");
    return;
  }
  response.status(200).send("Success");
};
