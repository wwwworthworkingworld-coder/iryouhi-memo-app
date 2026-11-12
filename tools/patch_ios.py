"""cap add ios で作ったプロジェクトに、このアプリの設定を入れる。py tools/patch_ios.py（最初に1回）"""
import re
from pathlib import Path

IOS = Path(__file__).parent.parent / "ios" / "App"
plist = IOS / "App" / "Info.plist"
s = plist.read_text(encoding="utf-8")
s = s.replace("<key>CFBundleDevelopmentRegion</key>\n\t<string>en</string>", "<key>CFBundleDevelopmentRegion</key>\n\t<string>ja</string>")
s = s.replace("<string>armv7</string>", "<string>arm64</string>")
s = re.sub(r"(<key>UISupportedInterfaceOrientations</key>\s*<array>\s*<string>UIInterfaceOrientationPortrait</string>).*?(</array>)", r"\1\n\t\2", s, count=1, flags=re.S)
if "NSCameraUsageDescription" not in s:
    s = s.replace("<key>LSRequiresIPhoneOS</key>",
                  "<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n"
                  "\t<key>NSCameraUsageDescription</key>\n\t<string>レシートを撮って、日付と金額を読み取るために使います。写真は保存せず、どこにも送信しません。</string>\n"
                  "\t<key>LSRequiresIPhoneOS</key>")
plist.write_text(s, encoding="utf-8")

(IOS / "App" / "PrivacyInfo.xcprivacy").write_text("""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyCollectedDataTypes</key>
	<array/>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array><string>CA92.1</string></array>
		</dict>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array><string>C617.1</string></array>
		</dict>
	</array>
</dict>
</plist>
""", encoding="utf-8")

pb = IOS / "App.xcodeproj" / "project.pbxproj"
s = pb.read_text(encoding="utf-8")
s = s.replace('TARGETED_DEVICE_FAMILY = "1,2";', 'TARGETED_DEVICE_FAMILY = 1;')
s = s.replace("IPHONEOS_DEPLOYMENT_TARGET = 15.0;", "IPHONEOS_DEPLOYMENT_TARGET = 16.0;")
s = s.replace("MARKETING_VERSION = 1.0;", "MARKETING_VERSION = 1.0.0;")
if "PrivacyInfo.xcprivacy" not in s:
    FILE, BUILD = "A1B2C3D41FED79650016851F", "A1B2C3D51FED79650016851F"
    s = s.replace("/* Begin PBXBuildFile section */\n",
                  f"/* Begin PBXBuildFile section */\n\t\t{BUILD} /* PrivacyInfo.xcprivacy in Resources */ = {{isa = PBXBuildFile; fileRef = {FILE} /* PrivacyInfo.xcprivacy */; }};\n")
    s = s.replace("/* Begin PBXFileReference section */\n",
                  f"/* Begin PBXFileReference section */\n\t\t{FILE} /* PrivacyInfo.xcprivacy */ = {{isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = \"<group>\"; }};\n")
    s = s.replace("\t\t\t\t504EC30E1FED79650016851F /* Assets.xcassets */,\n",
                  f"\t\t\t\t504EC30E1FED79650016851F /* Assets.xcassets */,\n\t\t\t\t{FILE} /* PrivacyInfo.xcprivacy */,\n")
    s = s.replace("\t\t\t\t504EC30F1FED79650016851F /* Assets.xcassets in Resources */,\n",
                  f"\t\t\t\t504EC30F1FED79650016851F /* Assets.xcassets in Resources */,\n\t\t\t\t{BUILD} /* PrivacyInfo.xcprivacy in Resources */,\n")
pb.write_text(s, encoding="utf-8")
print("ok")
