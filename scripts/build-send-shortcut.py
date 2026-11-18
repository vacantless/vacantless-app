#!/usr/bin/env python3
# S816l: builds the unsigned "Send to Vacantless" Apple Shortcut. Sign it on a
# Mac with: shortcuts sign --mode anyone --input <in> --output <out>
import plistlib, sys, uuid

URL = "https://app.vacantless.com/api/shortcut/renter"
OBJ = "￼"
u_key, u_img, u_post = (str(uuid.uuid4()).upper() for _ in range(3))

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
     "WFWorkflowActionParameters": {"UUID": u_key, "WFTextActionText": "Paste your Vacantless key here"}},
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
    {"WFWorkflowActionIdentifier": "is.workflow.actions.showresult",
     "WFWorkflowActionParameters": {"Text": txt(OBJ, out(u_post, "Contents of URL"))}},
]

wf = {
    "WFWorkflowClientVersion": "2605.0.5",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowTypes": ["ActionExtension"],
    "WFWorkflowInputContentItemClasses": ["WFImageContentItem"],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowImportQuestions": [{
        "ActionIndex": 0, "Category": "Parameter", "ParameterKey": "WFTextActionText",
        "Text": "Paste your Vacantless key. Make it on Quick replies in Vacantless.", "DefaultValue": "",
    }],
    "WFWorkflowActions": actions,
    "WFQuickActionSurfaces": [],
}
with open(sys.argv[1], "wb") as f:
    plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
print("wrote", sys.argv[1])
