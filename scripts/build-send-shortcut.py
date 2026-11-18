#!/usr/bin/env python3
# S816l: builds the unsigned "Send to Vacantless" Apple Shortcut. Sign it on a
# Mac with: shortcuts sign --mode anyone --input <in> --output <out>
# S817b: v=2 answers in JSON; the Shortcut copies "reply" (the Quick replies
# text) and shows "line". SEND_KEY_FILE=<file> builds your own copy with your
# key inside (no question when it is added); the file is never committed.
import os, plistlib, sys, uuid

URL = "https://app.vacantless.com/api/shortcut/renter?v=2"
KEY = open(os.environ["SEND_KEY_FILE"]).read().strip() if os.environ.get("SEND_KEY_FILE") else None
OBJ = "￼"
u_key, u_img, u_post, u_reply, u_line, u_if = (str(uuid.uuid4()).upper() for _ in range(6))

def out(uid, name):
    return {"Type": "ActionOutput", "OutputUUID": uid, "OutputName": name}

def att(v):
    return {"Value": v, "WFSerializationType": "WFTextTokenAttachment"}

def txt(s, attach=None):
    v = {"string": s}
    if attach:
        v["attachmentsByRange"] = {"{0, 1}": attach}
    return {"Value": v, "WFSerializationType": "WFTextTokenString"}

actions = [
    {"WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
     "WFWorkflowActionParameters": {"UUID": u_key, "WFTextActionText": KEY or "Paste your Vacantless key here"}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.image.convert",
     "WFWorkflowActionParameters": {"UUID": u_img, "WFImageFormat": "JPEG", "WFImagePreserveMetadata": False,
                                    "WFInput": att({"Type": "ExtensionInput"})}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
     "WFWorkflowActionParameters": {
         "UUID": u_post, "WFURL": URL, "WFHTTPMethod": "POST", "WFHTTPBodyType": "File", "ShowHeaders": True,
         "WFRequestVariable": att(out(u_img, "Converted Image")),
         "WFHTTPHeaders": {"Value": {"WFDictionaryFieldValueItems": [
             {"WFItemType": 0, "WFKey": txt("Authorization"),
              "WFValue": {"Value": {"string": "Bearer " + OBJ, "attachmentsByRange": {"{7, 1}": out(u_key, "Text")}},
                          "WFSerializationType": "WFTextTokenString"}},
         ]}, "WFSerializationType": "WFDictionaryFieldValue"}}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
     "WFWorkflowActionParameters": {"UUID": u_reply, "WFDictionaryKey": "reply",
                                    "WFInput": att(out(u_post, "Contents of URL"))}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
     "WFWorkflowActionParameters": {"GroupingIdentifier": u_if, "WFControlFlowMode": 0, "WFCondition": 100,
                                    "WFInput": {"Type": "Variable", "Variable": att(out(u_reply, "Dictionary Value"))}}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.setclipboard",
     "WFWorkflowActionParameters": {"WFInput": att(out(u_reply, "Dictionary Value"))}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
     "WFWorkflowActionParameters": {"GroupingIdentifier": u_if, "WFControlFlowMode": 2}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
     "WFWorkflowActionParameters": {"UUID": u_line, "WFDictionaryKey": "line",
                                    "WFInput": att(out(u_post, "Contents of URL"))}},
    {"WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
     "WFWorkflowActionParameters": {"Text": txt(OBJ, out(u_line, "Dictionary Value"))}},
]

wf = {
    "WFWorkflowClientVersion": "2605.0.5",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": ["WFImageContentItem"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowImportQuestions": [] if KEY else [{
        "ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText",
        "Text": "Paste your Vacantless key. Make it on Quick replies in Vacantless.", "DefaultValue": "",
    }],
    "WFWorkflowActions": actions,
    "WFQuickActionSurfaces": [],
}
with open(sys.argv[1], "wb") as f:
    plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
print("wrote", sys.argv[1])
