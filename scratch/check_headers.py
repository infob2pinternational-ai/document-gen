import urllib.request

url = "https://b2pinternational.com/"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        print("Final URL:", response.geturl())
        print("Status Code:", response.getcode())
        print("Headers:")
        for key, value in response.getheaders():
            print(f"  {key}: {value}")
except Exception as e:
    print("Error:", e)
