use reqwest::{Client};
use serde_json::Value;
use once_cell::sync::Lazy;

#[derive(Debug)]
pub struct Dropbox {
    client_id: &'static str,
    client_secret: &'static str,
    client: Client,
}

impl Dropbox {
    pub fn new(client_id: &'static str, client_secret: &'static str) -> Self {
        Self {
            client_id,
            client_secret,
            client: Client::new(),
        }
    }

    pub fn get_login_url(&self) -> String {
        format!(
            "https://www.dropbox.com/oauth2/authorize?response_type=code&client_id={}",
            self.client_id
        )
    }

    pub async fn get_auth_token(&self, auth_code: &str) -> Result<String, String> {
        let post_data = [
            ("code", auth_code),
            ("grant_type", "authorization_code"),
            ("client_id", self.client_id),
            ("client_secret", self.client_secret),
        ];

        let response = match self
            .client
            .post("https://api.dropboxapi.com/oauth2/token")
            .form(&post_data)
            .send()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                return Err(format!("failed due to : {e}"));
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("http code: {status}, body: {body}"));
        }

        let res_json: Value = response.json().await.map_err(|e| format!("failed to unmarshal with error {e}") )?;
        res_json["access_token"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("failed to get access_token") )
    }
    
    pub async fn check(&self) -> Result<(), String> {
        let response = match self
            .client
            .post("https://api.dropboxapi.com/2/check/app")
            .body("{\"query\":\"foo\"}")
            .send()
            .await
        {
            Ok(res) => res,
            Err(e) => {
                return Err(format!("failed due to : {e}"));
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("http code: {status}, body: {body}"));
        }
        
        Ok(())
    }

//     fn get_fresh_auth_token(&self) -> String {
//         format!("{}{}", self.client_id, self.client_secret)
//     }

//     pub async fn list(&self, path: &str) -> Result<(), Error> {
//         #[derive(Serialize)]
//         struct ListRequest {
//             path: String,
//         }
//
//         let response = self
//             .client
//             .post("https://api.dropboxapi.com/2/files/list_folder")
//             .bearer_auth(self.get_fresh_auth_token())
//             .json(&ListRequest {
//                 path: path.to_string(),
//             })
//             .send()
//             .await
//             .map_err(|e| Error::Network(e.to_string()))?;
//
//         if !response.status().is_success() {
//             let status = response.status();
//             let body = response.text().await.unwrap_or_default();
//             return Err(Error::Api(format!("Status Code {}, {}", status, body)));
//         }
//
//         Ok(())
//     }
//
//     pub async fn upload(&self) -> Result<(), Error> {
//         todo!("Implement upload method")
//     }
//
//     pub async fn download(&self) -> Result<(), Error> {
//         todo!("Implement download method")
//     }
}

