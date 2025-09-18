#!/bin/bash

# Android Build Test Script
# This script tests the Android build process and reports any issues

set -e

echo "🤖 Testing Android Build Process..."
echo "=================================="

# Check if we're in the right directory
if [ ! -d "android" ]; then
    echo "❌ Error: android directory not found"
    echo "Please run this script from the project root"
    exit 1
fi

cd android

echo "📁 Checking Android project structure..."

# Check essential files
required_files=(
    "build.gradle"
    "settings.gradle"
    "gradle.properties"
    "gradlew"
    "app/build.gradle"
    "app/src/main/AndroidManifest.xml"
)

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

echo ""
echo "🔧 Checking Gradle wrapper..."

if [ -f "gradle/wrapper/gradle-wrapper.jar" ]; then
    echo "✅ Gradle wrapper jar exists"
else
    echo "❌ Gradle wrapper jar missing"
    exit 1
fi

if [ -f "gradle/wrapper/gradle-wrapper.properties" ]; then
    echo "✅ Gradle wrapper properties exist"
    echo "   Gradle version: $(grep distributionUrl gradle/wrapper/gradle-wrapper.properties | cut -d'-' -f2 | cut -d'/' -f1)"
else
    echo "❌ Gradle wrapper properties missing"
    exit 1
fi

echo ""
echo "📱 Checking Android app structure..."

# Check app structure
app_files=(
    "app/src/main/java/xyz/chatboxapp/ce/MainActivity.kt"
    "app/src/main/java/xyz/chatboxapp/ce/ChatActivity.kt"
    "app/src/main/java/xyz/chatboxapp/ce/SettingsActivity.kt"
    "app/src/main/res/layout/activity_main.xml"
    "app/src/main/res/layout/activity_chat.xml"
    "app/src/main/res/layout/activity_settings.xml"
    "app/src/main/res/values/strings.xml"
    "app/src/main/res/values/colors.xml"
    "app/src/main/res/values/themes.xml"
)

for file in "${app_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

echo ""
echo "🔍 Checking for common issues..."

# Check for repository configuration issues
if grep -q "allprojects" build.gradle; then
    echo "⚠️  Warning: allprojects block found in build.gradle (may cause issues)"
else
    echo "✅ No allprojects block in build.gradle"
fi

# Check settings.gradle
if grep -q "PREFER_SETTINGS" settings.gradle; then
    echo "✅ Repository mode set to PREFER_SETTINGS"
else
    echo "⚠️  Warning: Repository mode not set to PREFER_SETTINGS"
fi

echo ""
echo "🚀 Testing Gradle build (dry run)..."

# Make gradlew executable
chmod +x gradlew

# Test Gradle configuration
echo "Testing Gradle configuration..."
if ./gradlew tasks --all > /dev/null 2>&1; then
    echo "✅ Gradle configuration is valid"
else
    echo "❌ Gradle configuration has issues"
    echo "Running with verbose output:"
    ./gradlew tasks --all --stacktrace
    exit 1
fi

echo ""
echo "📋 Available Gradle tasks:"
./gradlew tasks --all | grep -E "(assemble|build|test)" | head -10

echo ""
echo "🎯 Summary:"
echo "==========="
echo "✅ Android project structure is complete"
echo "✅ All required files are present"
echo "✅ Gradle configuration is valid"
echo "✅ Ready for GitHub Actions build"

echo ""
echo "📝 Next steps:"
echo "1. Push to GitHub to trigger the build"
echo "2. Check GitHub Actions for build status"
echo "3. Download APK from build artifacts"
echo "4. Test APK on Android device"

echo ""
echo "🔗 GitHub Actions URL:"
echo "https://github.com/you112ef/chatbox/actions"

echo ""
echo "🎉 Android build test completed successfully!"